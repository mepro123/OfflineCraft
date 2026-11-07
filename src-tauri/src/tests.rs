use crate::feat::analyze_crash;
use crate::mc::*;
use crate::skins::pack_format;
use crate::util::*;
use serde_json::json;

#[test] fn offline_uuid_matches_electron_build() { assert_eq!(offline_uuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f"); assert_eq!(offline_uuid("Player"), "a01e3843-e521-3998-958a-f459800e4d11"); }
#[test] fn maven_paths() { assert_eq!(maven_path("net.fabricmc:fabric-loader:0.15.0"), "net/fabricmc/fabric-loader/0.15.0/fabric-loader-0.15.0.jar"); assert_eq!(maven_path("a.b:c:1:natives-windows"), "a/b/c/1/c-1-natives-windows.jar"); assert_eq!(maven_path("a.b:c:1@zip"), "a/b/c/1/c-1.zip"); assert_eq!(maven_path("bad"), ""); }
#[test] fn rules() {
    assert!(rules_ok(&json!([]), false));
    assert!(!rules_ok(&json!([{ "action": "allow", "os": { "name": "osx" } }]), false));
    assert!(rules_ok(&json!([{ "action": "allow" }, { "action": "disallow", "os": { "name": "osx" } }]), false));
    assert!(!rules_ok(&json!([{ "action": "allow", "features": { "has_custom_resolution": true } }]), false));
    assert!(rules_ok(&json!([{ "action": "allow", "features": { "has_custom_resolution": true } }]), true));
}
#[test] fn libs_collect() {
    let mv = json!({ "libraries": [
        { "name": "a:b:1", "downloads": { "artifact": { "path": "a/b/1/b-1.jar", "url": "u", "size": 5 } } },
        { "name": "a:b:1", "downloads": { "artifact": { "path": "a/b/1/b-1.jar", "url": "u", "size": 5 } } },
        { "name": "x:y:2:natives-linux", "downloads": { "artifact": { "path": "p", "url": "u" } } },
        { "name": "x:y:2:natives-windows", "downloads": { "artifact": { "path": "q", "url": "u" } } },
        { "name": "o:l:3", "natives": { "windows": "natives-windows" }, "downloads": { "classifiers": { "natives-windows": { "path": "n.jar", "url": "u2" } } } } ] });
    let l = collect_libs(&mv); assert_eq!(l.len(), 3); assert!(l[1].native && l[1].on_classpath); assert!(l[2].native && !l[2].on_classpath);
}
#[test] fn crash_diagnosis() {
    assert_eq!(analyze_crash("java.lang.OutOfMemoryError: Java heap space", "vanilla", 2048, 1)["id"], "out-of-memory");
    assert_eq!(analyze_crash("Error: class file version 65.0, this version only recognizes up to 52.0 UnsupportedClassVersionError", "vanilla", 0, 1)["id"], "java-version");
    let r = analyze_crash("Mod 'a' (a) requires version 1 of 'b'", "fabric", 0, 1); assert_eq!(r["id"], "mod-deps"); assert!(r["detail"].as_str().unwrap().contains("a needs b"));
    assert_eq!(analyze_crash("nothing", "rust", 0, 1)["id"], "rust"); assert_eq!(analyze_crash("boom", "vanilla", 0, 3)["id"], "unknown");
}
#[test] fn helpers() {
    assert_eq!(split_args("a \"b c\" 'd e' f"), vec!["a", "b c", "d e", "f"]);
    assert!(!safe_rel("a/../b")); assert!(!safe_rel("/x")); assert!(!safe_rel("C:\\x")); assert!(safe_rel("a/b.txt"));
    assert_eq!(sanitize("a<b>:c. "), "a_b__c"); assert_eq!(sanitize(""), "unnamed");
    assert_eq!(pack_format("1.20.4"), 22); assert_eq!(pack_format("1.8.9"), 1); assert_eq!(pack_format("1.21.5"), 46);
    assert_eq!(parse_env("A=1\n# c\nB = two").len(), 2);
}
#[test] fn join_args_by_version() { assert_eq!(join_args(&json!({ "mc": "1.20.4" }), "h:1"), vec!["--quickPlayMultiplayer", "h:1"]); assert_eq!(join_args(&json!({ "mc": "1.12.2" }), "h:99"), vec!["--server", "h", "--port", "99"]); }
#[test] fn asset_urls() { let u = asset_url(std::path::Path::new("/a b/c.png")); assert!(u.ends_with("%2Fa%20b%2Fc.png")); }
