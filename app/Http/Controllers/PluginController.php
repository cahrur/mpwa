<?php

namespace App\Http\Controllers;

use App\Models\Plugin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Session;

class PluginController extends Controller
{
    // the uuid and key must be same
    protected $pluginsAvailable = [
        'chatgpt' => [
            'uuid' => 'chatgpt',
            'name' => 'ChatGPT',
            'main_field_label' => 'API Key',
            'description' => 'The AI will respond when a start command is triggered (if provided), otherwise it replies immediately.
All messages are saved, enabling continuous and contextual conversations.',
            'extra_fields' => [
                'dataset' => ['label' => 'Dataset Teks', 'type' => 'textarea'],
                'command_start' => ['label' => 'Command Start(Optional)', 'type' => 'text'],
                'command_stop' => ['label' => 'Command Stop(Optional)', 'type' => 'text'],
            ],
        ],
        'gemini' => [
            'uuid' => 'gemini',
            'name' => 'GeminiAI',
            'main_field_label' => 'API Key',
            'description' => 'The AI will respond when a start command is triggered (if provided), otherwise it replies immediately.
All messages are saved, enabling continuous and contextual conversations.',
            'extra_fields' => [
                'dataset' => ['label' => 'Dataset Teks', 'type' => 'textarea'],
                'command_start' => ['label' => 'Command Start(Optional)', 'type' => 'text'],
                'command_stop' => ['label' => 'Command Stop(Optional)', 'type' => 'text'],
            ],
        ],
        'claude' => [
            'uuid' => 'claude',
            'name' => 'Claude AI',
            'main_field_label' => 'API Key',
            'description' => 'The AI will respond when a start command is triggered (if provided), otherwise it replies immediately.
All messages are saved, enabling continuous and contextual conversations.',
            'extra_fields' => [
                'dataset' => ['label' => 'Dataset Teks', 'type' => 'textarea'],
                'command_start' => ['label' => 'Command Start(Optional)', 'type' => 'text'],
                'command_stop' => ['label' => 'Command Stop(Optional)', 'type' => 'text'],
            ],
        ],
        'spreadsheet' => [
            'uuid' => 'spreadsheet',
            'name' => 'Spreadsheet AutoRespon',
            'main_field_label' => 'Sheet URL',
            'description' => 'This for autorespon, get key and respon from googlesheet',
            'extra_fields' => [
                'googlekey' => ['label' => 'GOOGLE KEY', 'type' => 'text'],
            ]
        ],
        'spreadsheet-input' => [
            'uuid' => 'spreadsheet-input',
            'name' => 'Spreadsheet Save Data',
            'main_field_label' => 'SpreadSheet ID',
            'description' => 'To save data from message to spreadsheet, you can provide question and start command.',
            'extra_fields' => [
                'googlekey' => ['label' => 'JSON Google', 'type' => 'textarea'],
                'basickey' => ['label' => 'Key format time|from|name|media', 'type' => 'text'],
                'data_map' => ['label' => 'Mapping Data', 'type' => 'dynamic_pair'],
                'commandstart' => ['label' => 'Command Start', 'type' => 'text'],
                'finishmessage' => ['label' => 'Finish Message', 'type' => 'textarea'],
            ]
        ],
        'sticker' => [
            'uuid' => 'sticker',
            'description' => 'To convert image to sticker by startcommend, make sure you provide the start command.',
            'name' => 'Image To Sticker',
            'main_field_label' => null,
            'extra_fields' => [
                'command' => ['label' => 'Command', 'type' => 'text'],
            ]
        ],
    ];



    public function index()
    {
        $pluginsAvailable = $this->pluginsAvailable;
        $plugins = Plugin::where('device_id', Session::get('selectedDevice'))->get();

        return view('pages.plugins', compact('pluginsAvailable', 'plugins'));
    }

    public function store(Request $request)
    {

        $data = $request->validate([
            'plugin_type' => 'required|string',
            'main_data' => 'nullable|string',
            'extra_data' => 'nullable|array',
            'typeBot' => 'required|in:all,group,personal',
            'description' => 'nullable|string',
            'is_active' => 'nullable|boolean',
        ]);
        $deviceId = $request->device ?? Session::get('selectedDevice');
        $uuid = $this->pluginsAvailable[$data['plugin_type']]['uuid'];

        $existing = Plugin::where('device_id', $deviceId)->where('uuid', $uuid)->first();
        if ($existing) {
            return back()->with('alert', ['type' => 'danger', 'msg' => 'Same plugin already exists']);
        }

        $description = $this->pluginsAvailable[$data['plugin_type']]['description'] ?? null;

        Plugin::create([
            'uuid' => $this->pluginsAvailable[$data['plugin_type']]['uuid'],
            'device_id' => $request->device,
            'description' => $description,
            'name' => $this->pluginsAvailable[$data['plugin_type']]['name'],
            'main_data' => $data['main_data'] ?? "-",
            'extra_data' => $this->formatDynamicPair($data['extra_data'] ?? []),
            'typeBot' => $data['typeBot'],
            'is_active' => $request->has('is_active'),
        ]);
        clearCacheNode();
        return redirect()->back()->with('success', 'Plugin berhasil ditambahkan.');
    }

    public function editData(Plugin $plugin)
    {

        return response()->json([
            'id' => $plugin->id,
            'plugin_type' => $plugin->uuid,
            'main_data' => $plugin->main_data,
            'extra_data' => $plugin->extra_data,
            'typeBot' => $plugin->typeBot,
            'description' => $plugin->description,
            'is_active' => $plugin->is_active,
        ]);
    }


    public function update(Request $request, Plugin $plugin)
    {
        $data = $request->validate([
            'main_data' => 'nullable|string',
            'extra_data' => 'nullable|array',
            'typeBot' => 'required|in:all,group,personal',
            'is_active' => 'nullable|boolean',
        ]);


     

        $plugin->update([
            'main_data' => $data['main_data'] ?? "-",
          
            'extra_data' => $this->formatDynamicPair($data['extra_data'] ?? []),
            'typeBot' => $data['typeBot'],
           
            'is_active' => $request->has('is_active'),
        ]);

        clearCacheNode();

        return back()->with('success', 'Plugin berhasil diperbarui.');
    }

    private function formatDynamicPair($extraData)
    {
        $formatted = $extraData;

        foreach ($extraData as $key => $value) {

            if (is_array($value) && count($value) % 2 === 0) {
                $pairs = array_chunk($value, 2);
                $map = [];

                foreach ($pairs as $pair) {
                    if (isset($pair[0]) && isset($pair[1]) && $pair[0] !== '' && $pair[1] !== '') {
                        $map[$pair[0]] = $pair[1];
                    }
                }

                $formatted[$key] = $map;
            }
        }

        return $formatted;
    }
}
