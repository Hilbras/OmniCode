import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import 'src/config/settings_store.dart';
import 'src/state/app_state.dart';
import 'src/theme/omni_theme.dart';
import 'src/ui/connect_screen.dart';
import 'src/ui/sessions_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final AppState appState = AppState(settings: SettingsStore());
  final OmniThemeController themeController = OmniThemeController();
  await appState.loadSaved();
  await themeController.load();
  runApp(
    OmnicodeMobileApp(appState: appState, themeController: themeController),
  );
}

class OmnicodeMobileApp extends StatelessWidget {
  const OmnicodeMobileApp({
    required this.appState,
    required this.themeController,
    super.key,
  });

  final AppState appState;
  final OmniThemeController themeController;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<AppState>.value(
      value: appState,
      child: ChangeNotifierProvider<OmniThemeController>.value(
        value: themeController,
        child: Consumer<OmniThemeController>(
          builder: (
            BuildContext context,
            OmniThemeController controller,
            Widget? child,
          ) =>
              MaterialApp(
            title: 'Omnicode Mobile',
            theme: OmniTheme.lightTheme,
            darkTheme: OmniTheme.darkTheme,
            themeMode: controller.mode,
            themeAnimationDuration: OmniMotion.interaction,
            themeAnimationCurve: OmniMotion.ease,
            home: const _Root(),
          ),
        ),
      ),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final bool ready =
        context.select<AppState, bool>((AppState state) => state.isServerReady);
    return ready ? const SessionsScreen() : const ConnectScreen();
  }
}
