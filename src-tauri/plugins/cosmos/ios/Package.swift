// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-cosmos",
    platforms: [
        // LAContext.biometryType and .biometryCurrentSet both predate this, but 13 is what
        // src-tauri/tauri.conf.json declares as the app's floor and the two must agree.
        .iOS(.v13)
    ],
    products: [
        .library(
            name: "tauri-plugin-cosmos",
            type: .static,
            targets: ["tauri-plugin-cosmos"]
        )
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-cosmos",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources"
        )
    ]
)
