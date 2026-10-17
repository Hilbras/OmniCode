{
  description = "Omnicode CLI";

  inputs = {
    # Pinned to the 25.11 release channel because nixpkgs-unstable currently
    # ships nodejs_24 = 24.14.1, which trips the >= 24.15.0 floor that the
    # native SEA build enforces (see apps/omnicode/scripts/native/build.mjs).
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (import nixpkgs {
            inherit system;
          })
        );

      minNodeVersion = "24.15.0";

      # Hardcode to Node.js 24.x; fail the evaluation if the pinned nixpkgs
      # does not offer a new enough 24.x.
      nodejsFor =
        pkgs:
        let
          node = pkgs.nodejs_24;
        in
        if lib.versionAtLeast node.version minNodeVersion then
          node
        else
          throw ''
            Omnicode requires Node.js >= ${minNodeVersion},
            but nixpkgs only offers ${node.version}.
            Pin a newer nixpkgs revision or update minNodeVersion in flake.nix.
          '';

      pnpmFor =
        pkgs:
        pkgs.pnpm_10.override {
          nodejs = nodejsFor pkgs;
        };

      # -------------------------------------------------------------------
      # Workspace members (kept in sync with pnpm-workspace.yaml).
      #
      # HARD REQUIREMENT: whenever you add or remove a workspace package,
      # you MUST update both lists below. Missing a path will break the Nix
      # build (src fileset silently drops files); missing a name will break
      # pnpmConfigHook (dependencies for that workspace won't be fetched).
      # -------------------------------------------------------------------
      workspacePaths = [
        ./packages/omnicode-acp
        ./packages/omnicode-core
        ./packages/omnicode-server
        ./packages/omnicode-kaos
        ./packages/omnicode-client
        ./packages/omnicode-llm
        ./packages/omnicode-migration
        ./packages/omnicode-minidb
        ./packages/omnicode-remote
        ./packages/omnicode-sdk
        ./packages/omnicode-auth
        ./packages/omnicode-tui
        ./packages/omnicode-telemetry
        ./packages/omnicode-transcript
        ./packages/omnicode-tree-sitter-bash
        ./apps/omnicode
        ./apps/omnicode-inspect
        ./apps/omnicode-vis
        ./apps/omnicode-vis/server
        ./apps/omnicode-vis/web
        ./docs
      ];

      workspaceNames = [
        "@hilbras/omnicode-acp"
        "@hilbras/omnicode-core"
        "@hilbras/omnicode-server"
        "@hilbras/omnicode-kaos"
        "@hilbras/omnicode-client"
        "@hilbras/omnicode-llm"
        "@hilbras/omnicode-migration"
        "@hilbras/omnicode-minidb"
        "@hilbras/omnicode-remote"
        "@hilbras/omnicode-sdk"
        "@hilbras/omnicode-auth"
        "@hilbras/omnicode-tui"
        "@hilbras/omnicode-telemetry"
        "@hilbras/omnicode-transcript"
        "@hilbras/omnicode-tree-sitter-bash"
        "@hilbras/omnicode"
        "@hilbras/omnicode-inspect"
        "@hilbras/omnicode-vis"
        "@hilbras/omnicode-vis-server"
        "@hilbras/omnicode-vis-web"
        "omnicode-docs"
      ];
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          nodejs = nodejsFor pkgs;
          pnpm = pnpmFor pkgs;
          appPackageJson = builtins.fromJSON (builtins.readFile ./apps/omnicode/package.json);
          nativeTarget =
            if pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isAarch64 then
              "linux-arm64"
            else if pkgs.stdenv.hostPlatform.isLinux then
              "linux-x64"
            else if pkgs.stdenv.hostPlatform.isDarwin && pkgs.stdenv.hostPlatform.isAarch64 then
              "darwin-arm64"
            else if pkgs.stdenv.hostPlatform.isDarwin then
              "darwin-x64"
            else
              throw "Unsupported Omnicode native target for ${pkgs.stdenv.hostPlatform.system}";

          omnicode = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "omnicode";
            version = appPackageJson.version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                [
                  ./build
                  ./.npmrc
                  ./.nvmrc
                  ./package.json
                  ./pnpm-lock.yaml
                  ./pnpm-workspace.yaml
                  ./tsconfig.json
                  ./vitest.config.ts
                  ./LICENSE
                ]
                ++ workspacePaths
              );
            };

            pnpmWorkspaces = [ "." ] ++ workspaceNames;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src pnpmWorkspaces;
              inherit pnpm;
              fetcherVersion = 3;
              hash = "sha256-xrn34bQ76s+ouOZPHZ4TBkpTHxG7gZejmx8RqSii2uA=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              (pkgs.pnpmConfigHook.override { inherit pnpm; })
              pkgs.makeWrapper
            ]
            # The SEA inject step (postject) invalidates the macOS code
            # signature on the copied Node executable; build.mjs then re-applies
            # an ad-hoc signature via `codesign`. The Nix darwin sandbox does
            # not expose /usr/bin/codesign, so we supply nixpkgs' ad-hoc-only
            # replacement instead.
            ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
              pkgs.darwin.sigtool
            ];

            # The SEA binary is produced by `postject`-injecting a blob into a
            # plain Node executable. Stripping rewrites section tables and can
            # invalidate the injected blob's offsets, so leave the binary
            # untouched after the build.
            dontStrip = true;

            buildPhase = ''
              runHook preBuild
              export OMNICODE_BUILD_TARGET=${nativeTarget}
              ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
                # pkgs.darwin.sigtool's codesign supports `--sign -` (ad-hoc)
                # but not the inspection mode (`-dv`) that 05-verify.mjs runs
                # afterwards. Disable the verify step for the Nix build; the
                # release CI keeps it via the unmodified script.
                substituteInPlace apps/omnicode/scripts/native/build.mjs \
                  --replace-fail \
                    "await runVerifyStep({ requireGatekeeper: false });" \
                    "// runVerifyStep skipped in nix sandbox (sigtool lacks -dv)"
              ''}
              # The SEA blob step (scripts/native/02-sea-blob.mjs) embeds the
              # Omnicode web assets from apps/omnicode/dist-web and fails if that
              # directory is missing. The bundle is committed (synced from the
              # code-app repo) — verify it is in place before producing the
              # native executable.
              node apps/omnicode/scripts/check-web-assets.mjs
              pnpm --filter=@hilbras/omnicode run build:native:sea
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              install -Dm755 \
                "apps/omnicode/dist-native/bin/${nativeTarget}/omnicode" \
                "$out/bin/omnicode"

              runHook postInstall
            '';

            postInstall = ''
              wrapProgram $out/bin/omnicode --prefix PATH : ${lib.makeBinPath [ pkgs.ripgrep pkgs.fd ]}
            '';

            meta = {
              description = "Omnicode CLI";
              homepage = "https://github.com/Hilbras/omnicode";
              license = lib.licenses.mit;
              mainProgram = "omnicode";
              platforms = systems;
            };
          });
        in
        {
          inherit omnicode;
          default = omnicode;
        }
      );

      apps = forAllSystems (pkgs: {
        omnicode = {
          type = "app";
          program = "${self.packages.${pkgs.system}.omnicode}/bin/omnicode";
        };
        default = self.apps.${pkgs.system}.omnicode;
      });

      devShells = forAllSystems (pkgs: {
        default =
          let
            nodejs = nodejsFor pkgs;
            pnpm = pnpmFor pkgs;
          in
          pkgs.mkShell {
            packages = [
              nodejs
              pnpm
              pkgs.ripgrep
              pkgs.fd
            ];
          };
      });
    };
}
