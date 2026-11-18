import 'package:flutter_svg/flutter_svg.dart';
import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import 'omni_palette.dart';
import 'omni_theme.dart';

class OmniFocusRing extends StatelessWidget {
  const OmniFocusRing({
    required this.focused,
    required this.borderRadius,
    required this.child,
    this.color,
    this.width = OmniMotion.focusRingWidth,
    this.offset = OmniMotion.focusRingOffset,
    super.key,
  });

  final bool focused;
  final BorderRadius borderRadius;
  final Widget child;
  final Color? color;
  final double width;
  final double offset;

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    return CustomPaint(
      foregroundPainter: focused
          ? _SpreadRingPainter(
              color: color ?? palette.focusRing,
              width: width,
              offset: offset,
              radius: borderRadius.topLeft.x,
            )
          : null,
      child: child,
    );
  }
}

class _SpreadRingPainter extends CustomPainter {
  const _SpreadRingPainter({
    required this.color,
    required this.width,
    required this.offset,
    required this.radius,
  });

  final Color color;
  final double width;
  final double offset;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    if (width <= 0) {
      return;
    }
    final double outset = offset + width / 2;
    final Rect rect = Rect.fromLTWH(0, 0, size.width, size.height).inflate(outset);
    final Paint paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width;
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(radius + outset)),
      paint,
    );
  }

  @override
  bool shouldRepaint(_SpreadRingPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.width != width ||
      oldDelegate.offset != offset ||
      oldDelegate.radius != radius;
}

enum OmniButtonVariant { gold, ghost, secondary, danger }

class OmniButton extends StatefulWidget {
  const OmniButton({
    required this.variant,
    required this.label,
    this.icon,
    this.onPressed,
    this.expanded = false,
    this.busy = false,
    super.key,
  });

  final OmniButtonVariant variant;
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expanded;
  final bool busy;

  @override
  State<OmniButton> createState() => _OmniButtonState();
}

class _OmniButtonState extends State<OmniButton> {
  bool _hovered = false;
  bool _pressed = false;
  bool _focused = false;

  bool get _enabled => widget.onPressed != null && !widget.busy;

  double get _radius => switch (widget.variant) {
        OmniButtonVariant.gold => OmniRadius.primary,
        OmniButtonVariant.ghost => OmniRadius.primary,
        OmniButtonVariant.secondary => OmniRadius.control,
        OmniButtonVariant.danger => OmniRadius.control,
      };

  EdgeInsets get _padding => switch (widget.variant) {
        OmniButtonVariant.gold => const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
        OmniButtonVariant.ghost => const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
        OmniButtonVariant.secondary => const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        OmniButtonVariant.danger => const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      };

  FontWeight get _weight => switch (widget.variant) {
        OmniButtonVariant.gold => OmniType.semibold,
        OmniButtonVariant.ghost => OmniType.medium,
        OmniButtonVariant.secondary => OmniType.medium,
        OmniButtonVariant.danger => OmniType.semibold,
      };

  /// `.btn-ghost:disabled` is not defined in the stylesheet; it borrows the
  /// 0.6 of the other non-primary buttons.
  double get _disabledOpacity => switch (widget.variant) {
        OmniButtonVariant.gold => 0.65,
        OmniButtonVariant.ghost => 0.6,
        OmniButtonVariant.secondary => 0.6,
        OmniButtonVariant.danger => 0.6,
      };

  bool get _liftsOnHover => switch (widget.variant) {
        OmniButtonVariant.gold => true,
        OmniButtonVariant.ghost => true,
        OmniButtonVariant.secondary => false,
        OmniButtonVariant.danger => false,
      };

  ({Color background, Color foreground, BorderSide border, List<BoxShadow> shadow}) _skin(
    OmniPalette palette, {
    required bool hovered,
    required bool pressed,
  }) {
    switch (widget.variant) {
      case OmniButtonVariant.gold:
        return (
          background: hovered || pressed ? palette.goldBright : palette.gold,
          foreground: palette.goldInk,
          border: BorderSide(color: palette.goldBorderMix),
          shadow: hovered
              ? palette.goldButtonShadowHover
              : palette.goldButtonShadow,
        );
      case OmniButtonVariant.ghost:
        return (
          background: hovered ? palette.goldSoft : palette.surface,
          foreground: palette.text,
          border: BorderSide(color: hovered ? palette.gold : palette.lineStrong),
          shadow: const <BoxShadow>[],
        );
      case OmniButtonVariant.secondary:
        return (
          background: palette.surface,
          foreground: hovered ? palette.goldText : palette.text,
          border: BorderSide(
            color: hovered ? palette.goldBorderHover : palette.lineStrong,
          ),
          shadow: const <BoxShadow>[],
        );
      case OmniButtonVariant.danger:
        return (
          background: hovered ? palette.dangerHoverBackground : Colors.transparent,
          foreground: palette.bad,
          border: BorderSide(color: palette.dangerBorder),
          shadow: const <BoxShadow>[],
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final bool enabled = _enabled;
    final Duration duration = OmniMotion.interactionFor(context);
    final bool reduced = OmniMotion.isReduced(context);
    final bool hovered = enabled && _hovered;
    final bool pressed = enabled && _pressed;
    final skin = _skin(palette, hovered: hovered, pressed: pressed);
    final BorderRadius radius = BorderRadius.circular(_radius);
    final double lift = reduced || !hovered || pressed || !_liftsOnHover
        ? 0.0
        : OmniMotion.hoverLift;
    final double scale = reduced || !pressed ? 1.0 : OmniMotion.pressScale;

    final Widget content = Padding(
      padding: _padding,
      child: Row(
        mainAxisSize: widget.expanded ? MainAxisSize.max : MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          if (widget.busy)
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: skin.foreground,
              ),
            )
          else if (widget.icon != null)
            Icon(widget.icon, size: 16, color: skin.foreground),
          if (widget.busy || widget.icon != null) const SizedBox(width: 8),
          Flexible(
            child: Text(
              widget.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: OmniFont.activeSans,
                fontSize: OmniType.button,
                fontWeight: _weight,
                color: skin.foreground,
              ),
            ),
          ),
        ],
      ),
    );

    return Opacity(
      opacity: enabled ? 1 : _disabledOpacity,
      child: TweenAnimationBuilder<Offset>(
        tween: Tween<Offset>(begin: Offset.zero, end: Offset(0, lift)),
        duration: duration,
        curve: OmniMotion.ease,
        builder: (BuildContext context, Offset value, Widget? child) =>
            Transform.translate(offset: value, child: child),
        child: AnimatedScale(
          scale: scale,
          duration: duration,
          curve: OmniMotion.ease,
          child: AnimatedContainer(
            duration: duration,
            curve: OmniMotion.ease,
            decoration: BoxDecoration(
              color: skin.background,
              borderRadius: radius,
              border: Border.fromBorderSide(skin.border),
              boxShadow: skin.shadow,
            ),
            child: Material(
              type: MaterialType.transparency,
              child: OmniFocusRing(
                focused: _focused,
                borderRadius: radius,
                child: InkWell(
                  borderRadius: radius,
                  onTap: enabled ? widget.onPressed : null,
                  onHover: (bool value) => setState(() => _hovered = value),
                  onFocusChange: (bool value) => setState(() => _focused = value),
                  onTapDown: enabled
                      ? (TapDownDetails details) => setState(() => _pressed = true)
                      : null,
                  onTapUp: enabled
                      ? (TapUpDetails details) => setState(() => _pressed = false)
                      : null,
                  onTapCancel: enabled
                      ? () => setState(() => _pressed = false)
                      : null,
                  child: content,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class GoldButton extends StatelessWidget {
  const GoldButton({
    required this.label,
    this.icon,
    this.onPressed,
    this.expanded = false,
    this.busy = false,
    super.key,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expanded;
  final bool busy;

  @override
  Widget build(BuildContext context) => OmniButton(
        variant: OmniButtonVariant.gold,
        label: label,
        icon: icon,
        onPressed: onPressed,
        expanded: expanded,
        busy: busy,
      );
}

class GhostButton extends StatelessWidget {
  const GhostButton({
    required this.label,
    this.icon,
    this.onPressed,
    this.expanded = false,
    this.busy = false,
    super.key,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expanded;
  final bool busy;

  @override
  Widget build(BuildContext context) => OmniButton(
        variant: OmniButtonVariant.ghost,
        label: label,
        icon: icon,
        onPressed: onPressed,
        expanded: expanded,
        busy: busy,
      );
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({
    required this.label,
    this.icon,
    this.onPressed,
    this.expanded = false,
    this.busy = false,
    super.key,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expanded;
  final bool busy;

  @override
  Widget build(BuildContext context) => OmniButton(
        variant: OmniButtonVariant.secondary,
        label: label,
        icon: icon,
        onPressed: onPressed,
        expanded: expanded,
        busy: busy,
      );
}

class DangerButton extends StatelessWidget {
  const DangerButton({
    required this.label,
    this.icon,
    this.onPressed,
    this.expanded = false,
    this.busy = false,
    super.key,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expanded;
  final bool busy;

  @override
  Widget build(BuildContext context) => OmniButton(
        variant: OmniButtonVariant.danger,
        label: label,
        icon: icon,
        onPressed: onPressed,
        expanded: expanded,
        busy: busy,
      );
}

class OmniCard extends StatefulWidget {
  const OmniCard({
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = OmniRadius.card,
    this.borderColor,
    this.background,
    this.shadow,
    this.onTap,
    this.animateEntrance = true,
    super.key,
  });

  final Widget child;
  final EdgeInsets padding;
  final double radius;
  final Color? borderColor;
  final Color? background;
  final List<BoxShadow>? shadow;
  final VoidCallback? onTap;
  final bool animateEntrance;

  @override
  State<OmniCard> createState() => _OmniCardState();
}

class _OmniCardState extends State<OmniCard> {
  bool _entered = false;

  @override
  void initState() {
    super.initState();
    _entered = !widget.animateEntrance;
    if (_entered) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        setState(() => _entered = true);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final BorderRadius radius = BorderRadius.circular(widget.radius);
    final Widget card = DecoratedBox(
      decoration: BoxDecoration(
        color: widget.background ?? palette.surface,
        borderRadius: radius,
        border: Border.all(color: widget.borderColor ?? palette.line),
        boxShadow: widget.shadow ?? palette.shadow,
      ),
      child: Material(
        type: MaterialType.transparency,
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onTap,
          borderRadius: radius,
          child: Padding(padding: widget.padding, child: widget.child),
        ),
      ),
    );

    if (!widget.animateEntrance) {
      return card;
    }

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0.0, end: _entered ? 1.0 : 0.0),
      duration: OmniMotion.entranceFor(context),
      curve: OmniMotion.ease,
      builder: (BuildContext context, double value, Widget? child) {
        final double scale = OmniMotion.entranceScale +
            (1.0 - OmniMotion.entranceScale) * value;
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, OmniMotion.entranceOffset * (1.0 - value)),
            child: Transform.scale(scale: scale, child: child),
          ),
        );
      },
      child: card,
    );
  }
}

class OmniInput extends StatefulWidget {
  const OmniInput({
    required this.controller,
    this.label,
    this.hint,
    this.helper,
    this.errorText,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.autocorrect = true,
    this.enableSuggestions = true,
    this.validator,
    this.onChanged,
    this.onFieldSubmitted,
    this.suffix,
    super.key,
  });

  final TextEditingController controller;
  final String? label;
  final String? hint;
  final String? helper;
  final String? errorText;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool autocorrect;
  final bool enableSuggestions;
  final String? Function(String?)? validator;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onFieldSubmitted;
  final Widget? suffix;

  @override
  State<OmniInput> createState() => _OmniInputState();
}

class _OmniInputState extends State<OmniInput> {
  final FocusNode _focusNode = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    _focusNode
      ..removeListener(_onFocusChange)
      ..dispose();
    super.dispose();
  }

  void _onFocusChange() {
    if (!mounted) {
      return;
    }
    setState(() => _focused = _focusNode.hasFocus);
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final BorderRadius radius = OmniRadius.primaryShape;
    final bool invalid = widget.errorText != null;
    final BorderSide enabledSide = BorderSide(
      color: invalid ? palette.bad : palette.lineStrong,
    );
    final BorderSide focusedSide = BorderSide(
      color: invalid ? palette.bad : palette.gold,
    );
    final TextStyle fieldStyle = TextStyle(
      fontFamily: OmniFont.activeSans,
      fontSize: OmniType.input,
      height: 1.35,
      color: palette.text,
    );

    return OmniFocusRing(
      focused: _focused,
      borderRadius: radius,
      color: palette.goldSoft,
      width: OmniMotion.inputRingWidth,
      offset: 0,
      child: TextFormField(
        controller: widget.controller,
        focusNode: _focusNode,
        style: fieldStyle,
        cursorColor: palette.gold,
        obscureText: widget.obscureText,
        keyboardType: widget.keyboardType,
        textInputAction: widget.textInputAction,
        autocorrect: widget.autocorrect,
        enableSuggestions: widget.enableSuggestions,
        validator: widget.validator,
        onChanged: widget.onChanged,
        onFieldSubmitted: widget.onFieldSubmitted,
        decoration: InputDecoration(
          filled: true,
          fillColor: palette.surface,
          isDense: true,
          alignLabelWithHint: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          labelText: widget.label,
          hintText: widget.hint,
          helperText: widget.helper,
          errorText: widget.errorText,
          suffixIcon: widget.suffix,
          suffixIconConstraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          labelStyle: TextStyle(
            fontFamily: OmniFont.activeSans,
            fontSize: OmniType.input,
            color: _focused ? palette.goldText : palette.muted,
          ),
          floatingLabelStyle: TextStyle(
            fontFamily: OmniFont.activeSans,
            fontSize: OmniType.notice,
            color: invalid ? palette.bad : palette.goldText,
          ),
          hintStyle: TextStyle(
            fontFamily: OmniFont.activeSans,
            fontSize: OmniType.input,
            color: palette.placeholderText,
          ),
          helperStyle: TextStyle(
            fontFamily: OmniFont.activeSans,
            fontSize: OmniType.notice,
            height: OmniType.noticeLineHeight,
            color: palette.muted,
          ),
          errorStyle: TextStyle(
            fontFamily: OmniFont.activeSans,
            fontSize: OmniType.fieldError,
            color: palette.bad,
          ),
          border: OutlineInputBorder(borderRadius: radius, borderSide: enabledSide),
          enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: enabledSide),
          disabledBorder: OutlineInputBorder(
            borderRadius: radius,
            borderSide: BorderSide(color: palette.line),
          ),
          focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: focusedSide),
          errorBorder: OutlineInputBorder(borderRadius: radius, borderSide: focusedSide),
          focusedErrorBorder: OutlineInputBorder(
            borderRadius: radius,
            borderSide: focusedSide,
          ),
        ),
      ),
    );
  }
}

enum OmniNoticeVariant { info, error }

class OmniNotice extends StatelessWidget {
  const OmniNotice({
    required this.message,
    this.variant = OmniNoticeVariant.info,
    this.icon,
    this.onDismiss,
    this.margin = const EdgeInsets.only(top: 16),
    super.key,
  });

  final String message;
  final OmniNoticeVariant variant;
  final IconData? icon;
  final VoidCallback? onDismiss;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final bool error = variant == OmniNoticeVariant.error;
    final Color accent = error ? palette.bad : palette.goldText;

    return Padding(
      padding: margin,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: error ? palette.noticeErrorBackground : palette.goldSoft,
          borderRadius: OmniRadius.primaryShape,
          border: Border.all(
            color: error ? palette.noticeErrorBorder : palette.noticeBorder,
          ),
        ),
        child: Padding(
          padding: EdgeInsets.fromLTRB(14, 11, onDismiss == null ? 14 : 6, 11),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Icon(
                  icon ?? (error ? Icons.error_outline : Icons.info_outline),
                  size: 16,
                  color: accent,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(
                    fontFamily: OmniFont.activeSans,
                    fontSize: OmniType.notice,
                    height: OmniType.noticeLineHeight,
                    color: palette.text,
                  ),
                ),
              ),
              if (onDismiss != null)
                IconButton(
                  icon: const Icon(Icons.close, size: 16),
                  onPressed: onDismiss,
                  tooltip: 'Dismiss',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  color: palette.muted,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class OmniStatusPill extends StatelessWidget {
  const OmniStatusPill({
    required this.label,
    required this.positive,
    this.icon,
    super.key,
  });

  final String label;
  final bool positive;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final Color accent = positive ? palette.ok : palette.bad;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OmniRadius.controlShape,
        border: Border.all(color: palette.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(
            icon ?? (positive ? Icons.link : Icons.link_off),
            size: 12,
            color: accent,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontFamily: OmniFont.activeSans,
              fontSize: OmniType.notice,
              fontWeight: OmniType.medium,
              color: palette.muted,
            ),
          ),
        ],
      ),
    );
  }
}

class OmniAppBar extends StatelessWidget implements PreferredSizeWidget {
  OmniAppBar({
    required this.title,
    this.actions,
    this.bottom,
    this.leading,
    this.automaticallyImplyLeading = true,
    super.key,
  }) : preferredSize = Size.fromHeight(
          kToolbarHeight + (bottom?.preferredSize.height ?? 0),
        );

  final String title;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;
  final Widget? leading;
  final bool automaticallyImplyLeading;

  @override
  final Size preferredSize;

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    return AppBar(
      title: Text(title),
      actions: actions,
      bottom: bottom,
      leading: leading,
      automaticallyImplyLeading: automaticallyImplyLeading,
      backgroundColor: palette.appBarBackground,
      foregroundColor: palette.text,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleSpacing: NavigationToolbar.kMiddleSpacing,
      titleTextStyle: Theme.of(context)
          .textTheme
          .titleMedium
          ?.copyWith(color: palette.text),
      iconTheme: IconThemeData(color: palette.text, size: 20),
      actionsIconTheme: IconThemeData(color: palette.text, size: 20),
      flexibleSpace: Align(
        alignment: Alignment.bottomCenter,
        child: SizedBox(
          height: 1,
          width: double.infinity,
          child: ColoredBox(color: palette.appBarBorder),
        ),
      ),
    );
  }
}

class OmniThemeToggle extends StatelessWidget {
  const OmniThemeToggle({super.key});

  @override
  Widget build(BuildContext context) {
    final OmniThemeController controller = context.watch<OmniThemeController>();
    return IconButton(
      tooltip: controller.modeLabel,
      icon: Icon(controller.modeIcon),
      onPressed: controller.cycle,
    );
  }
}

class OmniBrandMark extends StatelessWidget {
  const OmniBrandMark({this.size = 88, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      'assets/icon.svg',
      width: size,
      height: size,
      fit: BoxFit.contain,
      semanticsLabel: 'Omnicode',
    );
  }
}

class OmniDialog extends StatelessWidget {
  const OmniDialog({
    required this.title,
    required this.message,
    required this.actions,
    super.key,
  });

  final String title;
  final String message;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: OmniCard(
        animateEntrance: false,
        radius: OmniRadius.panel,
        shadow: palette.shadowRaised,
        borderColor: palette.lineStrong,
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: palette.muted,
                  ),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: <Widget>[
                for (final Widget action in actions)
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: action,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
