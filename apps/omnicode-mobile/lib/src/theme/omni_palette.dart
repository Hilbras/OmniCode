import 'dart:ui' show Brightness, Color, Offset;

import 'package:flutter/painting.dart' show BoxShadow;
import 'package:xterm/xterm.dart' show TerminalTheme, TerminalThemes;

/// Transcribed from OmniCloud `apps/web/src/index.css`. Every value below is a
/// literal, including the ones CSS computes with `color-mix(...)` or with an
/// `rgba()` alpha, because Flutter has no `color-mix` and blending at runtime
/// would drift from the web palette.
///
/// Shadow blur radii are half the CSS blur radius: CSS states the full extent
/// of the blur while `BoxShadow.blurRadius` behaves like a sigma. Adjust here,
/// nowhere else, if the shadows read too tight.
class OmniPalette {
  const OmniPalette({
    required this.brightness,
    required this.bg,
    required this.bgSoft,
    required this.surface,
    required this.surface2,
    required this.text,
    required this.muted,
    required this.line,
    required this.lineStrong,
    required this.gold,
    required this.goldBright,
    required this.goldText,
    required this.goldInk,
    required this.goldSoft,
    required this.glow,
    required this.ok,
    required this.bad,
    required this.goldBorderMix,
    required this.goldShadowColor,
    required this.goldShadowHoverColor,
    required this.goldBorderHover,
    required this.noticeBorder,
    required this.noticeErrorBorder,
    required this.noticeErrorBackground,
    required this.dangerBorder,
    required this.dangerHoverBackground,
    required this.appBarBackground,
    required this.appBarBorder,
    required this.placeholderText,
    required this.shadow,
    required this.shadowRaised,
    required this.goldButtonShadow,
    required this.goldButtonShadowHover,
  });

  final Brightness brightness;

  final Color bg;
  final Color bgSoft;
  final Color surface;
  final Color surface2;
  final Color text;
  final Color muted;
  final Color line;
  final Color lineStrong;

  final Color gold;
  final Color goldBright;
  final Color goldText;
  final Color goldInk;
  final Color goldSoft;
  final Color glow;

  final Color ok;
  final Color bad;

  final Color goldBorderMix;
  final Color goldShadowColor;
  final Color goldShadowHoverColor;
  final Color goldBorderHover;

  final Color noticeBorder;
  final Color noticeErrorBorder;
  final Color noticeErrorBackground;

  final Color dangerBorder;
  final Color dangerHoverBackground;

  final Color appBarBackground;
  final Color appBarBorder;

  final Color placeholderText;

  final List<BoxShadow> shadow;
  final List<BoxShadow> shadowRaised;
  final List<BoxShadow> goldButtonShadow;
  final List<BoxShadow> goldButtonShadowHover;

  Color get focusRing => gold;

  static const OmniPalette light = OmniPalette(
    brightness: Brightness.light,
    bg: Color(0xFFFAF9F5),
    bgSoft: Color(0xFFF3F0E7),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFF7F4EC),
    text: Color(0xFF17150F),
    muted: Color(0xFF6F6857),
    line: Color(0xFFE7E1D1),
    lineStrong: Color(0xFFD8D0BB),
    gold: Color(0xFFD4AF37),
    goldBright: Color(0xFFE9C963),
    goldText: Color(0xFF8A6D12),
    goldInk: Color(0xFFFFFFFF),
    goldSoft: Color.fromRGBO(212, 175, 55, 0.14),
    glow: Color.fromRGBO(212, 175, 55, 0.35),
    ok: Color(0xFF177D47),
    bad: Color(0xFFC23B31),
    goldBorderMix: Color(0xFF997E28),
    goldShadowColor: Color.fromRGBO(212, 175, 55, 0.22),
    goldShadowHoverColor: Color.fromRGBO(212, 175, 55, 0.26),
    goldBorderHover: Color.fromRGBO(212, 175, 55, 0.40),
    noticeBorder: Color.fromRGBO(212, 175, 55, 0.45),
    noticeErrorBorder: Color.fromRGBO(194, 59, 49, 0.45),
    noticeErrorBackground: Color.fromRGBO(194, 59, 49, 0.10),
    dangerBorder: Color.fromRGBO(194, 59, 49, 0.70),
    dangerHoverBackground: Color.fromRGBO(194, 59, 49, 0.10),
    appBarBackground: Color.fromRGBO(250, 249, 245, 0.94),
    appBarBorder: Color.fromRGBO(231, 225, 209, 0.78),
    placeholderText: Color.fromRGBO(111, 104, 87, 0.70),
    shadow: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(30, 25, 5, 0.04),
        offset: Offset(0, 1),
        blurRadius: 1,
      ),
      BoxShadow(
        color: Color.fromRGBO(30, 25, 5, 0.05),
        offset: Offset(0, 8),
        blurRadius: 14,
      ),
    ],
    shadowRaised: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(30, 25, 5, 0.10),
        offset: Offset(0, 12),
        blurRadius: 18,
      ),
    ],
    goldButtonShadow: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(212, 175, 55, 0.22),
        offset: Offset(0, 2),
        blurRadius: 4,
      ),
    ],
    goldButtonShadowHover: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(212, 175, 55, 0.26),
        offset: Offset(0, 4),
        blurRadius: 6,
      ),
    ],
  );

  static const OmniPalette dark = OmniPalette(
    brightness: Brightness.dark,
    bg: Color(0xFF0C0B09),
    bgSoft: Color(0xFF12100C),
    surface: Color(0xFF15130E),
    surface2: Color(0xFF1B1812),
    text: Color(0xFFF2EFE6),
    muted: Color(0xFF9C9584),
    line: Color(0xFF262117),
    lineStrong: Color(0xFF353021),
    gold: Color(0xFFE2BD52),
    goldBright: Color(0xFFF3D789),
    goldText: Color(0xFFE6C768),
    goldInk: Color(0xFF1A1503),
    goldSoft: Color.fromRGBO(226, 189, 82, 0.12),
    glow: Color.fromRGBO(226, 189, 82, 0.25),
    ok: Color(0xFF6FDB9B),
    bad: Color(0xFFFF8A80),
    goldBorderMix: Color(0xFFA3883B),
    goldShadowColor: Color.fromRGBO(226, 189, 82, 0.22),
    goldShadowHoverColor: Color.fromRGBO(226, 189, 82, 0.26),
    goldBorderHover: Color.fromRGBO(226, 189, 82, 0.40),
    noticeBorder: Color.fromRGBO(226, 189, 82, 0.45),
    noticeErrorBorder: Color.fromRGBO(255, 138, 128, 0.45),
    noticeErrorBackground: Color.fromRGBO(255, 138, 128, 0.10),
    dangerBorder: Color.fromRGBO(255, 138, 128, 0.70),
    dangerHoverBackground: Color.fromRGBO(255, 138, 128, 0.10),
    appBarBackground: Color.fromRGBO(12, 11, 9, 0.94),
    appBarBorder: Color.fromRGBO(38, 33, 23, 0.78),
    placeholderText: Color.fromRGBO(156, 149, 132, 0.70),
    shadow: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(0, 0, 0, 0.32),
        offset: Offset(0, 1),
        blurRadius: 1,
      ),
      BoxShadow(
        color: Color.fromRGBO(0, 0, 0, 0.32),
        offset: Offset(0, 10),
        blurRadius: 17,
      ),
    ],
    shadowRaised: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(0, 0, 0, 0.46),
        offset: Offset(0, 16),
        blurRadius: 21,
      ),
    ],
    goldButtonShadow: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(226, 189, 82, 0.22),
        offset: Offset(0, 2),
        blurRadius: 4,
      ),
    ],
    goldButtonShadowHover: <BoxShadow>[
      BoxShadow(
        color: Color.fromRGBO(226, 189, 82, 0.26),
        offset: Offset(0, 4),
        blurRadius: 6,
      ),
    ],
  );
}

/// The terminal viewport stays dark in both app themes, so its tokens come
/// straight from the dark palette instead of from `omniPaletteOf(context)`.
/// `TerminalTheme` has no cursor-accent slot, so `cursorAccent` records the
/// intended colour and renders nothing.
class OmniTerminalTokens {
  const OmniTerminalTokens._();

  static Color get background => OmniPalette.dark.bg;
  static Color get surface => OmniPalette.dark.surface;
  static Color get foreground => OmniPalette.dark.text;
  static Color get muted => OmniPalette.dark.muted;
  static Color get line => OmniPalette.dark.line;
  static Color get cursor => OmniPalette.dark.gold;
  static Color get cursorAccent => OmniPalette.dark.goldInk;
  static Color get selection => OmniPalette.dark.goldSoft;

  /// The ANSI and search-hit colours stay on the xterm default so an upstream
  /// palette change is inherited instead of being pinned here. `final`, not
  /// `const`: reading `OmniPalette.dark.gold` is not a constant expression.
  static final TerminalTheme xtermTheme = TerminalTheme(
    cursor: OmniPalette.dark.gold,
    selection: OmniPalette.dark.goldSoft,
    foreground: OmniPalette.dark.text,
    background: OmniPalette.dark.bg,
    black: TerminalThemes.defaultTheme.black,
    red: TerminalThemes.defaultTheme.red,
    green: TerminalThemes.defaultTheme.green,
    yellow: TerminalThemes.defaultTheme.yellow,
    blue: TerminalThemes.defaultTheme.blue,
    magenta: TerminalThemes.defaultTheme.magenta,
    cyan: TerminalThemes.defaultTheme.cyan,
    white: TerminalThemes.defaultTheme.white,
    brightBlack: TerminalThemes.defaultTheme.brightBlack,
    brightRed: TerminalThemes.defaultTheme.brightRed,
    brightGreen: TerminalThemes.defaultTheme.brightGreen,
    brightYellow: TerminalThemes.defaultTheme.brightYellow,
    brightBlue: TerminalThemes.defaultTheme.brightBlue,
    brightMagenta: TerminalThemes.defaultTheme.brightMagenta,
    brightCyan: TerminalThemes.defaultTheme.brightCyan,
    brightWhite: TerminalThemes.defaultTheme.brightWhite,
    searchHitBackground: TerminalThemes.defaultTheme.searchHitBackground,
    searchHitBackgroundCurrent:
        TerminalThemes.defaultTheme.searchHitBackgroundCurrent,
    searchHitForeground: TerminalThemes.defaultTheme.searchHitForeground,
  );
}
