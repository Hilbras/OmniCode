import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../config/server_config.dart';
import '../state/app_state.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key});

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _urlController = TextEditingController();
  final TextEditingController _tokenController = TextEditingController();

  bool _prefilled = false;
  bool _probing = false;
  bool _obscureToken = true;
  String? _probeResult;

  String get _baseUrl => _urlController.text.trim();

  String get _token => _tokenController.text.trim();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_prefilled) {
      return;
    }
    _prefilled = true;
    final ServerConfig? saved = context.read<AppState>().config;
    if (saved != null) {
      _urlController.text = saved.baseUrl;
      _tokenController.text = saved.token;
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppState state = context.watch<AppState>();
    final ThemeData theme = Theme.of(context);
    final OmniPalette palette = omniPaletteOf(context);
    final String? probeResult = _probeResult;
    final String? error = state.errorMessage;
    final String? notice = state.notice;
    final bool busy = _probing || state.isBusy;

    return Scaffold(
      appBar: OmniAppBar(
        title: 'Omnicode',
        automaticallyImplyLeading: false,
        actions: <Widget>[
          if (state.config != null)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(
                child: DangerButton(
                  label: 'Forget',
                  onPressed: state.isBusy ? null : _forget,
                ),
              ),
            ),
          const OmniThemeToggle(),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const Center(child: OmniBrandMark(size: 88)),
                const SizedBox(height: 20),
                Center(
                  child: Text(
                    'Connect to a daemon',
                    style: theme.textTheme.headlineSmall,
                  ),
                ),
                const SizedBox(height: 8),
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Text(
                      'This app is a remote control. The agent keeps running on '
                      'the machine that hosts the daemon; nothing is executed '
                      'here.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: palette.muted,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                OmniCard(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      OmniInput(
                        controller: _urlController,
                        label: 'Daemon URL',
                        hint: 'http://192.168.1.20:8787',
                        helper:
                            'http or https, host and port. A path prefix is kept.',
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        textInputAction: TextInputAction.next,
                        validator: (String? value) =>
                            value == null || value.trim().isEmpty
                                ? 'Enter the daemon URL'
                                : null,
                      ),
                      const SizedBox(height: 16),
                      OmniInput(
                        controller: _tokenController,
                        label: 'Bearer token',
                        helper:
                            'Sent as "Authorization: Bearer" over REST and as the '
                            'omnicode.bearer.<token> WebSocket subprotocol.',
                        obscureText: _obscureToken,
                        autocorrect: false,
                        enableSuggestions: false,
                        suffix: IconButton(
                          icon: Icon(
                            _obscureToken
                                ? Icons.visibility
                                : Icons.visibility_off,
                            size: 18,
                          ),
                          onPressed: () =>
                              setState(() => _obscureToken = !_obscureToken),
                          tooltip: _obscureToken ? 'Show token' : 'Hide token',
                        ),
                      ),
                      const SizedBox(height: 20),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: GhostButton(
                              label: 'Test healthz',
                              icon: Icons.monitor_heart_outlined,
                              onPressed: busy ? null : _probe,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: GoldButton(
                              label: 'Connect',
                              icon: Icons.link,
                              onPressed: busy ? null : _connect,
                            ),
                          ),
                        ],
                      ),
                      if (busy)
                        const Padding(
                          padding: EdgeInsets.only(top: 20),
                          child: LinearProgressIndicator(),
                        ),
                      if (probeResult != null)
                        OmniNotice(
                          message: probeResult,
                          icon: Icons.monitor_heart_outlined,
                        ),
                      if (error != null)
                        OmniNotice(
                          message: error,
                          variant: OmniNoticeVariant.error,
                        ),
                      if (notice != null) OmniNotice(message: notice),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _probe() async {
    final AppState state = context.read<AppState>();
    setState(() {
      _probing = true;
      _probeResult = null;
    });
    final ({ServerConfig? config, String? error}) result =
        await state.probeHealth(
      baseUrl: _baseUrl,
      token: _token,
    );
    if (!mounted) {
      return;
    }
    final ServerConfig? config = result.config;
    setState(() {
      _probing = false;
      _probeResult = result.error ??
          'Daemon reachable at ${config?.displayUrl ?? _baseUrl}';
    });
  }

  Future<void> _connect() async {
    final FormState? form = _formKey.currentState;
    if (form != null && !form.validate()) {
      return;
    }
    final AppState state = context.read<AppState>();
    setState(() {
      _probing = true;
      _probeResult = null;
    });
    await state.connect(baseUrl: _baseUrl, token: _token);
    if (!mounted) {
      return;
    }
    setState(() {
      _probing = false;
    });
  }

  Future<void> _forget() async {
    final AppState state = context.read<AppState>();
    await state.forgetServer();
    if (!mounted) {
      return;
    }
    setState(() {
      _urlController.clear();
      _tokenController.clear();
      _probeResult = null;
    });
  }
}
