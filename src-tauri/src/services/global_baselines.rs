//! Shipped sprint-tuned global setup baselines, one per known car folder.
//!
//! Each JSON asset was derived from a real "copilot_fast" setup file found in that
//! car's own folders (correct schema + value ranges), then adjusted for short
//! sprint races: most aggressive ECU map, race-compound brake pads, and a fuel
//! load sized for roughly a 20-minute stint (~16 laps at 1.15x that car's
//! observed fuel-per-lap). Everything else (alignment, dampers, ARB, wheel
//! rate, aero, brake bias) is kept as tuned in the source file.
//!
//! Cars without a shipped baseline fall back to a schema-valid, neutral
//! skeleton (see [`skeleton_json_for`]) so the setup is always loadable in
//! game even though it is not tuned.

const BENTLEY_CONTINENTAL_GT3_2018: &str =
    include_str!("global_baselines/bentley_continental_gt3_2018.json");
const BMW_M4_GT3: &str = include_str!("global_baselines/bmw_m4_gt3.json");
const FERRARI_296_GT3: &str = include_str!("global_baselines/ferrari_296_gt3.json");
const FORD_MUSTANG_GT3: &str = include_str!("global_baselines/ford_mustang_gt3.json");
const LEXUS_RC_F_GT3: &str = include_str!("global_baselines/lexus_rc_f_gt3.json");
const MCLAREN_720S_GT3_EVO: &str = include_str!("global_baselines/mclaren_720s_gt3_evo.json");
const PORSCHE_991II_GT3_CUP: &str = include_str!("global_baselines/porsche_991ii_gt3_cup.json");
const PORSCHE_992_GT3_R: &str = include_str!("global_baselines/porsche_992_gt3_r.json");

/// Returns the shipped sprint baseline JSON for a known car folder name, if one exists.
pub fn baseline_json_for(car_folder: &str) -> Option<&'static str> {
    match car_folder {
        "bentley_continental_gt3_2018" => Some(BENTLEY_CONTINENTAL_GT3_2018),
        "bmw_m4_gt3" => Some(BMW_M4_GT3),
        "ferrari_296_gt3" => Some(FERRARI_296_GT3),
        "ford_mustang_gt3" => Some(FORD_MUSTANG_GT3),
        "lexus_rc_f_gt3" => Some(LEXUS_RC_F_GT3),
        "mclaren_720s_gt3_evo" => Some(MCLAREN_720S_GT3_EVO),
        "porsche_991ii_gt3_cup" => Some(PORSCHE_991II_GT3_CUP),
        "porsche_992_gt3_r" => Some(PORSCHE_992_GT3_R),
        _ => None,
    }
}

/// Builds a schema-valid, neutral-value setup for a car with no shipped baseline,
/// so a brand new car folder always gets something ACC can load.
pub fn skeleton_json_for(car_folder: &str) -> String {
    let template: serde_json::Value =
        serde_json::from_str(BENTLEY_CONTINENTAL_GT3_2018).expect("baseline asset is valid JSON");
    let mut skeleton = template;
    if let Some(map) = skeleton.as_object_mut() {
        map.insert(
            "carName".to_owned(),
            serde_json::Value::String(car_folder.to_owned()),
        );
    }
    serde_json::to_string_pretty(&skeleton).unwrap_or_else(|_| "{}".to_owned())
}

/// Content to seed a car's master with: the shipped baseline if known, otherwise a
/// neutral skeleton patched with the car's own folder name.
pub fn seed_content_for(car_folder: &str) -> String {
    baseline_json_for(car_folder)
        .map(str::to_owned)
        .unwrap_or_else(|| skeleton_json_for(car_folder))
}

#[cfg(test)]
mod tests {
    use super::{baseline_json_for, skeleton_json_for};

    const KNOWN_CAR_FOLDERS: &[&str] = &[
        "bentley_continental_gt3_2018",
        "bmw_m4_gt3",
        "ferrari_296_gt3",
        "ford_mustang_gt3",
        "lexus_rc_f_gt3",
        "mclaren_720s_gt3_evo",
        "porsche_991ii_gt3_cup",
        "porsche_992_gt3_r",
    ];

    #[test]
    fn every_known_car_has_a_valid_baseline_with_matching_car_name() {
        for car_folder in KNOWN_CAR_FOLDERS {
            let raw = baseline_json_for(car_folder)
                .unwrap_or_else(|| panic!("missing baseline for '{car_folder}'"));
            let value: serde_json::Value =
                serde_json::from_str(raw).unwrap_or_else(|error| {
                    panic!("baseline for '{car_folder}' is not valid JSON: {error}")
                });
            assert_eq!(
                value.get("carName").and_then(serde_json::Value::as_str),
                Some(*car_folder),
                "baseline carName mismatch for '{car_folder}'"
            );
            assert_eq!(
                value["basicSetup"]["strategy"]["frontBrakePadCompound"], 1,
                "'{car_folder}' baseline should use race-compound front pads"
            );
            assert_eq!(
                value["basicSetup"]["strategy"]["rearBrakePadCompound"], 1,
                "'{car_folder}' baseline should use race-compound rear pads"
            );
        }
    }

    #[test]
    fn unknown_car_gets_a_schema_valid_skeleton_with_patched_car_name() {
        let raw = skeleton_json_for("some_future_car");
        let value: serde_json::Value =
            serde_json::from_str(&raw).expect("skeleton must be valid JSON");
        assert_eq!(
            value.get("carName").and_then(serde_json::Value::as_str),
            Some("some_future_car")
        );
        // Structurally it should still look like a real ACC setup file.
        assert!(value.get("basicSetup").is_some());
        assert!(value.get("advancedSetup").is_some());
    }
}
