import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'omni_palette.dart';

/// Geist is the house face and Geist Mono the house mono face, but the binaries
/// are not in this tree. Both stay `null` until the `.ttf` files land in
/// `assets/fonts/` and the `fonts:` block from `README.md` is added to
/// `pubspec.yaml`; a declared-but-missing family breaks the build, so the app
/// runs on the Flutter default face meanwhile.
class OmniFont {
  const OmniFont._();

  static const String sans = 'Geist';
  static const String mono = 'Geist Mono';
  static const String? activeSans = null;
  static const String? activeMono = null;
}

class OmniRadius {
  const OmniRadius._();

  static const double control = 8;
  static const double primary = 10;
  static const double media = 12;
  static const double card = 16;
  static const double panel = 18;

  static BorderRadius get controlShape => BorderRadius.circular(control);
  static BorderRadius get primaryShape => BorderRadius.circular(primary);
  static BorderRadius get mediaShape => BorderRadius.circular(media);
  static BorderRadius get cardShape => BorderRadius.circular(card);
  static BorderRadius get panelShape => BorderRadius.circular(panel);
}

class OmniType {
  const OmniType._();

  static const double button = 14;
  static const double input = 14.5;
  static const double notice = 13;
  static const double fieldError = 12.5;
  static const double noticeLineHeight = 1.5;
  static const FontWeight semibold = FontWeight.w600;
  static const FontWeight medium = FontWeight.w500;
}

class OmniMotion {
  const OmniMotion._();

  static const Duration interaction = Duration(milliseconds: 140);
  static const Duration entrance = Duration(milliseconds: 220);
  static const Curve ease = Cubic(0.22, 1, 0.36, 1);
  static const double hoverLift = -1;
  static const double pressScale = 0.98;
  static const double entranceOffset = 8;
  static const double entranceScale = 0.985;
  static const double focusRingWidth = 2;
  static const double focusRingOffset = 2;
  static const double inputRingWidth = 3;

  static bool isReduced(BuildContext context) {
    final MediaQueryData? query = MediaQuery.maybeOf(context);
    if (query == null) {
      return false;
    }
    return query.disableAnimations || query.accessibleNavigation;
  }

  static Duration interactionFor(BuildContext context) =>
      isReduced(context) ? Duration.zero : interaction;

  static Duration entranceFor(BuildContext context) =>
      isReduced(context) ? Duration.zero : entrance;
}

OmniPalette omniPaletteOf(BuildContext context) {
  final ThemeData theme = Theme.of(context);
  return theme.brightness == Brightness.dark ? OmniPalette.dark : OmniPalette.light;
}

class OmniTheme {
  const OmniTheme._();

  static final ThemeData lightTheme = _build(OmniPalette.light);
  static final ThemeData darkTheme = _build(OmniPalette.dark);

  static ThemeData _build(OmniPalette palette) {
    final ColorScheme scheme = _colorScheme(palette);
    final ThemeData seed = ThemeData(
      useMaterial3: true,
      brightness: palette.brightness,
      colorScheme: scheme,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: palette.brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: palette.bg,
      canvasColor: palette.bg,
      cardColor: palette.surface,
      dividerColor: palette.line,
      splashColor: palette.goldSoft,
      highlightColor: palette.goldSoft,
      fontFamily: OmniFont.activeSans,
      textTheme: _textTheme(seed.textTheme, palette),
      iconTheme: IconThemeData(color: palette.muted, size: 20),
      primaryIconTheme: IconThemeData(color: palette.text, size: 20),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: _materialButton(palette, gold: true),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: _materialButton(palette, gold: true),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: _materialButton(palette, gold: false).copyWith(
          side: WidgetStatePropertyAll<BorderSide>(
            BorderSide(color: palette.lineStrong),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith<Color>(
            (Set<WidgetState> states) => states.contains(WidgetState.disabled)
                ? palette.muted
                : palette.goldText,
          ),
          textStyle: const WidgetStatePropertyAll<TextStyle>(
            TextStyle(
              fontFamily: OmniFont.activeSans,
              fontSize: OmniType.button,
              fontWeight: OmniType.medium,
            ),
          ),
          padding: const WidgetStatePropertyAll<EdgeInsetsGeometry>(
            EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          ),
          shape: WidgetStatePropertyAll<OutlinedBorder>(
            RoundedRectangleBorder(borderRadius: OmniRadius.controlShape),
          ),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith<Color>(
            (Set<WidgetState> states) => states.contains(WidgetState.disabled)
                ? palette.placeholderText
                : palette.text,
          ),
          iconSize: const WidgetStatePropertyAll<double>(20),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: palette.gold,
        foregroundColor: palette.goldInk,
        splashColor: palette.goldSoft,
        elevation: 0,
        highlightElevation: 0,
        focusElevation: 0,
        hoverElevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: OmniRadius.primaryShape,
          side: BorderSide(color: palette.goldBorderMix),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: palette.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 2,
        textStyle: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.button,
          fontWeight: OmniType.medium,
          color: palette.text,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: OmniRadius.primaryShape,
          side: BorderSide(color: palette.line),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: palette.muted,
        textColor: palette.text,
        titleTextStyle: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.button,
          fontWeight: OmniType.medium,
          color: palette.text,
        ),
        subtitleTextStyle: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.notice,
          color: palette.muted,
        ),
        shape: RoundedRectangleBorder(borderRadius: OmniRadius.cardShape),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: palette.surface2,
        contentTextStyle: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.notice,
          color: palette.text,
        ),
        actionTextColor: palette.goldText,
        elevation: 0,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: OmniRadius.primaryShape,
          side: BorderSide(color: palette.line),
        ),
      ),
      tabBarTheme: TabBarThemeData(indicatorColor: palette.gold),
      dividerTheme: DividerThemeData(
        color: palette.line,
        thickness: 1,
        space: 1,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: palette.gold,
        linearTrackColor: palette.line,
        circularTrackColor: palette.line,
        linearMinHeight: 2,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: palette.surface2,
          borderRadius: OmniRadius.controlShape,
          border: Border.all(color: palette.line),
        ),
        textStyle: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.notice,
          color: palette.text,
        ),
      ),
    );
  }

  static ColorScheme _colorScheme(OmniPalette palette) {
    final ColorScheme base = palette.brightness == Brightness.dark
        ? const ColorScheme.dark()
        : const ColorScheme.light();
    return base.copyWith(
      primary: palette.gold,
      onPrimary: palette.goldInk,
      primaryContainer: palette.goldBright,
      onPrimaryContainer: palette.goldInk,
      secondary: palette.goldText,
      onSecondary: palette.surface,
      secondaryContainer: palette.surface2,
      onSecondaryContainer: palette.text,
      tertiary: palette.goldBright,
      onTertiary: palette.goldInk,
      error: palette.bad,
      onError: palette.surface,
      errorContainer: palette.noticeErrorBackground,
      onErrorContainer: palette.text,
      surface: palette.surface,
      onSurface: palette.text,
      onSurfaceVariant: palette.muted,
      outline: palette.lineStrong,
      outlineVariant: palette.line,
      shadow: palette.text,
      scrim: palette.text,
      inverseSurface: palette.text,
      onInverseSurface: palette.bg,
      inversePrimary: palette.goldText,
    );
  }

  static TextTheme _textTheme(TextTheme base, OmniPalette palette) {
    final TextTheme tinted = base.apply(
      bodyColor: palette.text,
      displayColor: palette.text,
    );
    return tinted.copyWith(
      headlineSmall: tinted.headlineSmall?.copyWith(
        fontWeight: OmniType.semibold,
        color: palette.text,
      ),
      titleLarge: tinted.titleLarge?.copyWith(
        fontWeight: OmniType.semibold,
        color: palette.text,
      ),
      titleMedium: tinted.titleMedium?.copyWith(
        fontWeight: OmniType.semibold,
        color: palette.text,
      ),
      titleSmall: tinted.titleSmall?.copyWith(
        fontWeight: OmniType.medium,
        color: palette.text,
      ),
      bodyLarge: tinted.bodyLarge?.copyWith(height: 1.55),
      bodyMedium: tinted.bodyMedium?.copyWith(height: 1.55),
      bodySmall: tinted.bodySmall?.copyWith(height: OmniType.noticeLineHeight),
      labelLarge: tinted.labelLarge?.copyWith(
        fontSize: OmniType.button,
        fontWeight: OmniType.medium,
      ),
      labelSmall: tinted.labelSmall?.copyWith(height: 1.4),
    );
  }

  static ButtonStyle _materialButton(OmniPalette palette, {required bool gold}) {
    final Color background = gold ? palette.gold : palette.surface;
    final Color foreground = gold ? palette.goldInk : palette.text;
    final Color disabledBackground = gold ? palette.goldSoft : palette.surface2;
    return ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith<Color>(
        (Set<WidgetState> states) {
          if (states.contains(WidgetState.disabled)) {
            return disabledBackground;
          }
          if (states.contains(WidgetState.pressed) && gold) {
            return palette.goldBright;
          }
          if (states.contains(WidgetState.hovered) && gold) {
            return palette.goldBright;
          }
          if (!gold && states.contains(WidgetState.hovered)) {
            return palette.goldSoft;
          }
          return background;
        },
      ),
      foregroundColor: WidgetStateProperty.resolveWith<Color>(
        (Set<WidgetState> states) => states.contains(WidgetState.disabled)
            ? palette.muted
            : (!gold && states.contains(WidgetState.hovered)
                ? palette.goldText
                : foreground),
      ),
      overlayColor: WidgetStatePropertyAll<Color>(palette.goldSoft),
      elevation: const WidgetStatePropertyAll<double>(0),
      shadowColor: const WidgetStatePropertyAll<Color>(Colors.transparent),
      textStyle: WidgetStatePropertyAll<TextStyle>(
        TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.button,
          fontWeight: gold ? OmniType.semibold : OmniType.medium,
        ),
      ),
      padding: WidgetStatePropertyAll<EdgeInsetsGeometry>(
        EdgeInsets.symmetric(horizontal: gold ? 18 : 14, vertical: gold ? 9 : 8),
      ),
      minimumSize: const WidgetStatePropertyAll<Size>(Size(0, 0)),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      shape: WidgetStatePropertyAll<OutlinedBorder>(
        RoundedRectangleBorder(
          borderRadius: gold ? OmniRadius.primaryShape : OmniRadius.controlShape,
          side: BorderSide(
            color: gold ? palette.goldBorderMix : palette.lineStrong,
          ),
        ),
      ),
    );
  }
}

class OmniThemeController extends ChangeNotifier {
  OmniThemeController({ThemeMode mode = ThemeMode.system}) : _mode = mode;

  static const String storageKey = 'omnicode.ui.themeMode';

  ThemeMode _mode;

  ThemeMode get mode => _mode;

  String get modeLabel => switch (_mode) {
        ThemeMode.system => 'System theme',
        ThemeMode.light => 'Light theme',
        ThemeMode.dark => 'Dark theme',
      };

  IconData get modeIcon => switch (_mode) {
        ThemeMode.system => Icons.brightness_auto_outlined,
        ThemeMode.light => Icons.light_mode_outlined,
        ThemeMode.dark => Icons.dark_mode_outlined,
      };

  Future<void> load() async {
    final String? stored = await _read();
    final ThemeMode mode = _parse(stored);
    if (mode == _mode) {
      return;
    }
    _mode = mode;
    notifyListeners();
  }

  Future<void> setMode(ThemeMode mode) async {
    if (mode == _mode) {
      return;
    }
    _mode = mode;
    notifyListeners();
    await _write(mode);
  }

  void cycle() => unawaited(
        setMode(
          switch (_mode) {
            ThemeMode.system => ThemeMode.light,
            ThemeMode.light => ThemeMode.dark,
            ThemeMode.dark => ThemeMode.system,
          },
        ),
      );

  static ThemeMode _parse(String? value) => switch (value) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };

  Future<String?> _read() async {
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      return prefs.getString(storageKey);
    } on Object {
      return null;
    }
  }

  Future<void> _write(ThemeMode mode) async {
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      await prefs.setString(storageKey, mode.name);
    } on Object {
      return;
    }
  }
}
