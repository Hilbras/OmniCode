import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';

enum LibraryTab { apps, files, media }

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, this.initialTab = LibraryTab.apps});

  final LibraryTab initialTab;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late LibraryTab _currentTab;
  String _layout = 'grid';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _currentTab = widget.initialTab;
    _tabController = TabController(length: 3, vsync: this, initialIndex: _tabIndex(_currentTab));
    _tabController.addListener(_onTabChanged);
  }

  @override
  void dispose() {
    _tabController.removeListener(_onTabChanged);
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  int _tabIndex(LibraryTab tab) {
    switch (tab) {
      case LibraryTab.apps: return 0;
      case LibraryTab.files: return 1;
      case LibraryTab.media: return 2;
    }
  }

  void _onTabChanged() {
    if (!_tabController.indexIsChanging) {
      setState(() {
        _currentTab = LibraryTab.values[_tabController.index];
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);

    return Scaffold(
      appBar: OmniAppBar(
        title: 'Library',
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
        bottom: TabBar(
          controller: _tabController,
          tabs: const <Tab>[
            Tab(text: 'Apps'),
            Tab(text: 'Files'),
            Tab(text: 'Media'),
          ],
          labelColor: palette.gold,
          unselectedLabelColor: palette.muted,
          indicatorColor: palette.gold,
        ),
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: OmniInput(
                    controller: _searchController,
                    hint: _searchPlaceholder,
                    onChanged: (String v) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 12),
                IconButton(
                  icon: Icon(_layout == 'grid' ? Icons.view_list : Icons.grid_view, color: palette.muted),
                  onPressed: () => setState(() => _layout = _layout == 'grid' ? 'list' : 'grid'),
                  tooltip: _layout == 'grid' ? 'List view' : 'Grid view',
                ),
              ],
            ),
          ),
          Divider(height: 1, color: palette.line),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: <Widget>[
                _buildAppsTab(context, palette),
                _buildFilesTab(context, palette),
                _buildMediaTab(context, palette),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String get _searchPlaceholder {
    switch (_currentTab) {
      case LibraryTab.apps: return 'Search apps';
      case LibraryTab.files: return 'Search files';
      case LibraryTab.media: return 'Search media';
    }
  }

  Widget _buildAppsTab(BuildContext context, OmniPalette palette) {
    // Placeholder - in real app this would load from API
    return _emptyState(
      context,
      palette,
      icon: Icons.apps_outlined,
      title: 'No apps yet',
      subtitle: 'Create your first app with Grok Build',
      actionLabel: 'Build',
      onAction: () => Navigator.of(context).pop(),
    );
  }

  Widget _buildFilesTab(BuildContext context, OmniPalette palette) {
    return _emptyState(
      context,
      palette,
      icon: Icons.folder_open_outlined,
      title: 'No files yet',
      subtitle: 'Upload files to use in conversations',
      actionLabel: 'Upload',
      onAction: () {},
    );
  }

  Widget _buildMediaTab(BuildContext context, OmniPalette palette) {
    return _emptyState(
      context,
      palette,
      icon: Icons.image_outlined,
      title: 'No media yet',
      subtitle: 'Generate images and videos to see them here',
      actionLabel: 'Imagine',
      onAction: () {},
    );
  }

  Widget _emptyState(BuildContext context, OmniPalette palette, {
    required IconData icon,
    required String title,
    required String subtitle,
    required String actionLabel,
    required VoidCallback onAction,
  }) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 64, color: palette.muted),
          const SizedBox(height: 16),
          Text(
            title,
            style: TextStyle(
              fontFamily: OmniFont.activeSans,
              fontSize: OmniType.button,
              color: palette.text,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            subtitle,
            style: TextStyle(
              fontFamily: OmniFont.activeSans,
              fontSize: OmniType.notice,
              color: palette.muted,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          GoldButton(
            label: actionLabel,
            icon: Icons.add,
            onPressed: onAction,
          ),
        ],
      ),
    );
  }
}