// The about page: languages and the version.
import "./style.css";
import { T, apply, mountSwitch } from "./i18n";
import { VERSION } from "./version";

apply();
mountSwitch();
document.getElementById("aboutVer")!.textContent = T("String Art version {v}", { v: VERSION });
