import { parseIncomingMessage, delayMsg } from "../lib/helper.js";
import {
  isExistsEqualCommand,
  isExistsContainCommand,
  getUrlWebhook,
  getDevice,
} from "../database/model.js";
import {
  handleMediaReply,
  handleButtonReply,
  handleListReply,
  handleTextReply,
  getPpUrlFromSock,
} from "../service/replyHandler.js";
import { sendWebhook } from "../service/webhook.js";
import { runPlugins } from "../plugins/pluginManager.js";
import { isJidNewsletter } from "baileys";

const lastMessageMap = {}; // key: chatId, value: lastMessageId
let isFirstConnect = true; // skip batch pertama pesan saat connect

const IncomingMessage = async (msgBatch, type, sock) => {
  for (const received of msgBatch) {
    if (
      type !== "notify" ||
      !received?.message ||
      received.message?.protocolMessage ||
      received.message.senderKeyDistributionMessage
    ) {
      return;
    }



    if (received.key.remoteJid === "status@broadcast") return;
    const messageType = Object.keys(received.message)[0];

    let msg = received;

    if (msg.key.fromMe || msg.key.remoteJid === "status@broadcast" || isJidNewsletter(msg.key.remoteJid)) return;

    const senderName = msg?.pushName || "";
    if (!sock?.user?.id) return;
    const numberWa = sock.user.id.split(":")[0];
    let { command, media, from } = await parseIncomingMessage(msg, sock);

    const participant = msg.key.participant;
    const device = await getDevice(numberWa);
    let quoted = false;

    const isGroup = msg.key.remoteJid?.endsWith("@g.us");

    // Grup: hanya proses jika bot di-mention
    if (isGroup) {
      const msgContent = msg.message || {};
      const deviceJid = numberWa + "@s.whatsapp.net";
      const deviceLid = sock?.user?.lid?.split(":")[0];

      // Cek mentionedJid dari semua layer (handle reply/quote & ephemeral)
      const allContextInfos = [];
      const collectContextInfo = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (obj.contextInfo) allContextInfos.push(obj.contextInfo);
        for (const val of Object.values(obj)) collectContextInfo(val);
      };
      collectContextInfo(msgContent);

      const mentionedJids = allContextInfos.flatMap(ci => ci.mentionedJid || []);

      const isMentionedViaJid = mentionedJids.some(jid =>
        jid === deviceJid ||
        jid.includes(numberWa) ||
        (deviceLid && jid.includes(deviceLid))
      );

      // Fallback: cek teks pesan langsung mengandung @nomor bot
      const rawText = command || "";
      const shortNumber = numberWa.startsWith("62") ? "0" + numberWa.slice(2) : "";
      const isMentionedInText =
        rawText.includes("@" + numberWa) ||
        (shortNumber && rawText.includes("@" + shortNumber));

      console.log("[GROUP-MENTION] jids:", mentionedJids, "viaJid:", isMentionedViaJid, "viaText:", isMentionedInText);

      if (!isMentionedViaJid && !isMentionedInText) continue;
    }

    // Strip mention (@628xxx) dari command untuk pesan grup
    if (isGroup && command) {
      command = command.replace(/@\d+\s*/g, "").trim();
    }

    if (device.length > 0 && device[0].wh_read === 1) {
      try { sock.readMessages([msg.key]); } catch (e) { }
    }

    const pluginContext = {
      msg,
      sock,
      command,
      from,
      senderName,
      numberWa,
      device,
      participant,
      media,
    };



    // === PARALLEL PROMISES ===
    const webhookPromise = (async () => {
      const url = await getUrlWebhook(numberWa);

      if (!url) return null;

      const ppUrl = await getPpUrlFromSock(sock, msg);

      const response = await sendWebhook({
        device: numberWa,
        command,
        media,
        from,
        name: senderName,
        url,
        participant,
        ppUrl,
      });



      return typeof response === "object" ? response : null;
    })();

    const autoreplyPromise = (async () => {
      let result = await isExistsEqualCommand(command, numberWa);
      if (!result.length)
        result = await isExistsContainCommand(command, numberWa);
      if (!result.length) return null;

      const matched = result[0];
      const isReplyNeeded =
        matched.reply_when === "All" ||
        (matched.reply_when === "Group" &&
          msg.key.remoteJid.includes("@g.us")) ||
        (matched.reply_when === "Personal" &&
          !msg.key.remoteJid.includes("@g.us"));
      console.log("ar p", isReplyNeeded);
      if (!isReplyNeeded) return null;

      return typeof matched.reply === "object" ? matched.reply : matched.reply;
    })();

    const pluginsPromise = runPlugins(pluginContext); // bisa async internalnya

    // === RUN ALL IN PARALLEL ===
    const [webhookResult, autoreplyResult, pluginResult] =
      await Promise.allSettled([
        webhookPromise,
        autoreplyPromise,
        pluginsPromise,
      ]);

    // === PICK REPLY IF ANY ===

    let reply = null;
    if (autoreplyResult.status === "fulfilled" && autoreplyResult.value) {
      reply = autoreplyResult.value;
    } else if (webhookResult.status === "fulfilled" && webhookResult.value) {
      reply = webhookResult.value;
      quoted = webhookResult.value?.quoted || false;
    } else if (
      pluginResult.status === "fulfilled" &&
      pluginResult.value?.handled
    ) {
      const typeBot = pluginResult.value.typeBot || "all";

      const isGroup = msg.key.remoteJid.includes("@g.us");

      const isReplyNeeded =
        typeBot === "all" ||
        (typeBot === "group" && isGroup) ||
        (typeBot === "personal" && !isGroup);

      if (isReplyNeeded) {
        reply = pluginResult.value.reply;
        quoted = pluginResult.value.quoted || false;
      }
    }

    // === SEND REPLY IF EXISTS ===

    if (reply) {
      if (device.length > 0 && device[0].wh_typing === 1) {
        await delayMsg(2 * 1000, sock, msg.key.remoteJid, true);
      }
      if (typeof reply === "string") reply = JSON.parse(reply);
      if (typeof reply === "object" && reply?.text?.includes("{name}")) {
        reply = JSON.parse(
          JSON.stringify(reply).replace(/{name}/g, senderName)
        );
      }

      if (reply.type) {
        return await handleMediaReply(reply, sock, msg, quoted);
      } else if (reply.buttons) {
        return await handleButtonReply(reply, sock, msg);
      } else if (reply.sections) {
        return await handleListReply(reply, sock, msg);
      } else {
        return await handleTextReply(reply, sock, msg, quoted);
      }
    }

  }

  // try {
  //   if (!msgBatch || !msgBatch.messages || msgBatch.messages.length === 0)
  //     return;


  //   let msg = msgBatch.messages[0];
  //   if (!msg || !msg.message) return;

  //   const chatId = msg.key.remoteJid;
  //   const messageId = msg.key.id;

  //   // Skip batch pertama saat connect (agar pesan lama tidak diproses)
  //   if (isFirstConnect) {
  //     console.log("Skipping old messages on first connect...");
  //     isFirstConnect = false;
  //     return;
  //   }

  //   const msgContent = JSON.stringify(msg.message);
  //   console.log(msgContent)
  //   const msgHash = `${msg.key.id}_${msgContent}`;
  //   // Skip jika pesan sama persis
  //   if (lastMessageMap[chatId] === msgHash) return;

  //  lastMessageMap[chatId] = msgHash;

  //  // Skip pesan sendiri / broadcast / newsletter
  //  if (
  //    msg.key.fromMe ||
  //    msg.key.remoteJid === "status@broadcast" ||
  //    isJidNewsletter(msg.key.remoteJid)
  //  )
  //    return;

  //   const senderName = msg?.pushName || "";
  //   const numberWa = sock.user.id.split(":")[0];
  //   const { command, media, from } = await parseIncomingMessage(msg, sock);
  //   if (!command) return;
  //   const participant = msg.key.participant;
  //   const device = await getDevice(numberWa);
  //   let quoted = false;

  //   if (device.length > 0 && device[0].wh_read === 1) {
  //     sock.readMessages([msg.key]);
  //   }

  //   const pluginContext = {
  //     msg,
  //     sock,
  //     command,
  //     from,
  //     senderName,
  //     numberWa,
  //     device,
  //     participant,
  //     media,
  //   };



  //   // === PARALLEL PROMISES ===
  //   const webhookPromise = (async () => {
  //     const url = await getUrlWebhook(numberWa);

  //     if (!url) return null;

  //     const ppUrl = await getPpUrlFromSock(sock, msg);

  //     const response = await sendWebhook({
  //       device: numberWa,
  //       command,
  //       media,
  //       from,
  //       name: senderName,
  //       url,
  //       participant,
  //       ppUrl,
  //     });



  //     return typeof response === "object" ? response : null;
  //   })();

  //   const autoreplyPromise = (async () => {
  //     let result = await isExistsEqualCommand(command, numberWa);
  //     if (!result.length)
  //       result = await isExistsContainCommand(command, numberWa);
  //     if (!result.length) return null;

  //     const matched = result[0];
  //     const isReplyNeeded =
  //       matched.reply_when === "All" ||
  //       (matched.reply_when === "Group" &&
  //         msg.key.remoteJid.includes("@g.us")) ||
  //       (matched.reply_when === "Personal" &&
  //         !msg.key.remoteJid.includes("@g.us"));
  //     console.log("ar p", isReplyNeeded);
  //     if (!isReplyNeeded) return null;

  //     return typeof matched.reply === "object" ? matched.reply : matched.reply;
  //   })();

  //   const pluginsPromise = runPlugins(pluginContext); // bisa async internalnya

  //   // === RUN ALL IN PARALLEL ===
  //   const [webhookResult, autoreplyResult, pluginResult] =
  //     await Promise.allSettled([
  //       webhookPromise,
  //       autoreplyPromise,
  //       pluginsPromise,
  //     ]);

  //   // === PICK REPLY IF ANY ===

  //   let reply = null;
  //   if (autoreplyResult.status === "fulfilled" && autoreplyResult.value) {
  //     reply = autoreplyResult.value;
  //   } else if (webhookResult.status === "fulfilled" && webhookResult.value) {
  //     reply = webhookResult.value;
  //     quoted = webhookResult.value?.quoted || false;
  //   } else if (
  //     pluginResult.status === "fulfilled" &&
  //     pluginResult.value?.handled
  //   ) {
  //     const typeBot = pluginResult.value.typeBot || "all";

  //     const isGroup = msg.key.remoteJid.includes("@g.us");

  //     const isReplyNeeded =
  //       typeBot === "all" ||
  //       (typeBot === "group" && isGroup) ||
  //       (typeBot === "personal" && !isGroup);

  //     if (isReplyNeeded) {
  //       reply = pluginResult.value.reply;
  //       quoted = pluginResult.value.quoted || false;
  //     }
  //   }

  //   // === SEND REPLY IF EXISTS ===

  //   if (reply) {
  //     if (device.length > 0 && device[0].wh_typing === 1) {
  //       await delayMsg(2 * 1000, sock, msg.key.remoteJid, true);
  //     }
  //     if (typeof reply === "string") reply = JSON.parse(reply);
  //     if (typeof reply === "object" && reply?.text?.includes("{name}")) {
  //       reply = JSON.parse(
  //         JSON.stringify(reply).replace(/{name}/g, senderName)
  //       );
  //     }

  //     if (reply.type) {
  //       return await handleMediaReply(reply, sock, msg, quoted);
  //     } else if (reply.buttons) {
  //       return await handleButtonReply(reply, sock, msg);
  //     } else if (reply.sections) {
  //       return await handleListReply(reply, sock, msg);
  //     } else {
  //       return await handleTextReply(reply, sock, msg, quoted);
  //     }
  //   }
  // } catch (e) {
  //   if (e.message?.includes("decrypt")) {
  //     console.warn("[WA] Pesan gagal didekripsi, diabaikan.");
  //     return;
  //   }
  //   console.error("IncomingMessage error:", e);
  // }
};

export { IncomingMessage };
