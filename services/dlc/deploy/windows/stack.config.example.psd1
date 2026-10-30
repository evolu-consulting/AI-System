@{
    # Copy to stack.config.psd1 (same folder or -Config path) and fill in. No secrets here: passwords and
    # tokens are asked for at run time or generated into <InstallRoot>\secrets (ACL: Administrators + SYSTEM).

    VpsIp              = "203.0.113.10"        # the address browsers use; also the Keycloak hostname and app links
    InstallRoot        = "C:\DLC"

    # ports
    KeycloakHttpsPort  = 8443                  # Keycloak MUST be https: its login cookies are 'Secure'
    KhPort             = 9300                  # knowledge store, bound to 127.0.0.1 only (agents on this host)
    EnginePort         = 8796                  # DLC engine API + board
    FePort             = 8795                  # default frontend
    AppPorts           = "9100-9199"           # where completed apps are started ("Start app" button)

    # who may reach the engine API directly (the customer's own frontend backend); "Any" = everyone
    EngineAllowedRemote = "Any"
    # the customer's own frontend, for the 'customer-fe' Keycloak client (edit later in the admin console too)
    CustomerFeOrigin   = "http://203.0.113.20:3000"
    CustomerFeRedirect = "http://203.0.113.20:3000/*"

    # artifacts copied to the VPS (folder holding all of them)
    ArtifactsDir       = "C:\DLC-install"
    JdkZip             = "OpenJDK21U-jdk_x64_windows_hotspot.zip"   # Temurin 21 (Keycloak 26 needs Java 21)
    KeycloakZip        = "keycloak-26.0.7.zip"
    WinSwExe           = "WinSW-x64.exe"                            # WinSW 2.12.0
    KhZip              = "KnowledgeHub-win64.zip"                   # zip of the built KnowledgeHub folder
    DlcZip             = "dlc-0.1.0-win64.zip"                      # DLC engine package
    FeZip              = "dlc-fe-0.2.0-win64.zip"                   # default frontend package
    FeExe              = "dlc-fe.exe"                               # entry point inside FeZip
    FeArgs             = "serve"                                    # frontend command line (serve the UI + API)
    KhSigningKeyFile   = "kh-signing-key.pem"                       # Ed25519 PEM made on the build machine

    # engine behaviour for this customer (agents only, nobody answers questions)
    MaxParallelUnits   = 3                     # builder threads per run (x runs = concurrent agents; keep total <= 10)
    MaxUsdRun          = 6
    HumanMode          = "decide"              # the model decides open questions and logs every decision
    # existing code a project may start from (a picked folder or a git clone into it); "" = new projects only.
    # The engine service (LocalSystem) reads and writes there; every repository must stay inside this folder.
    WorkspaceRoot      = ""                    # e.g. "C:\Workspaces"
    # the Python that runs Python projects' tests; needed when Python is installed per user (LocalSystem does not
    # see it). Set by upgrade-stack.ps1 as LINE_PYTHON and first on the engine's PATH. "" = whatever PATH has.
    PythonExe          = ""                    # e.g. "C:\Python312\python.exe"
}
