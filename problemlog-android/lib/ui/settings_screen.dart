import 'package:flutter/material.dart';

import '../services/settings_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _controller = TextEditingController();
  bool _obscure = true;
  bool _loading = true;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    SettingsService.instance.getApiKey().then((key) {
      if (!mounted) return;
      setState(() {
        _controller.text = key ?? '';
        _loading = false;
      });
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await SettingsService.instance.setApiKey(_controller.text);
    if (!mounted) return;
    setState(() => _saved = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('API key saved on this device.')),
    );
  }

  Future<void> _clear() async {
    await SettingsService.instance.clearApiKey();
    if (!mounted) return;
    setState(() {
      _controller.clear();
      _saved = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text('Claude API key', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 6),
                Text(
                  'Used only to call the Claude API directly from this device when '
                  'you tap "Analyze". Stored in the Android keystore, never sent '
                  'anywhere except api.anthropic.com.',
                  style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _controller,
                  obscureText: _obscure,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: 'API key',
                    hintText: 'sk-ant-...',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  onChanged: (_) => setState(() => _saved = false),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        onPressed: _controller.text.trim().isEmpty || _saved ? null : _save,
                        child: Text(_saved ? 'Saved' : 'Save key'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: _controller.text.isEmpty ? null : _clear,
                      child: const Text('Clear'),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text(
                  'Get a key at console.anthropic.com → API Keys. This app makes '
                  'one API call per problem you analyze; check the Anthropic '
                  'console for usage and cost.',
                  style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ],
            ),
    );
  }
}
