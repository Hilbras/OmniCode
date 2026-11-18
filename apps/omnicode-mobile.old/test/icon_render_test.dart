import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vector_graphics/vector_graphics_compat.dart' as compat;

// Generator, not a behavior test: rasterizes assets/icon.svg into the PNGs the
// launcher-icon step needs. Run with `flutter test test/icon_render_test.dart`
// after editing the SVG. The launcher foreground is padded so the tile survives
// the adaptive-icon safe zone (which shows only the middle ~66%).
void main() {
  testWidgets('renders the brand icon to PNG sources', (tester) async {
    await tester.runAsync(() async {
      final tile = await _rasterize(1024);
      await File('assets/icon.png').writeAsBytes(tile);

      final padded = await _rasterize(1024, target: 1706);
      await File('assets/icon_adaptive_foreground.png').writeAsBytes(padded);
    });
  });
}

Future<List<int>> _rasterize(int size, {int? target}) async {
  final canvas = target ?? size;
  final info = await compat.vg.loadPicture(
    const SvgAssetLoader('assets/icon.svg'),
    null,
  );
  final recorder = ui.PictureRecorder();
  final draw = ui.Canvas(recorder);
  if (target != null) {
    draw.scale(size / canvas);
    draw.translate((canvas - size) / 2, (canvas - size) / 2);
  }
  draw.drawPicture(info.picture);
  info.picture.dispose();
  final image = await recorder.endRecording().toImage(canvas, canvas);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List();
}
