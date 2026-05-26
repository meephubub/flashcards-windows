import blessed from "blessed";
import fs from "fs";
import { execSync } from "child_process";

function getPkg() {
  return JSON.parse(fs.readFileSync("package.json", "utf8"));
}

function writePkg(pkg) {
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));
}

function getTauri() {
  return JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
}

function writeTauri(cfg) {
  fs.writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(cfg, null, 2));
}

function bump(version, type) {
  const [a, b, c] = version.split(".").map(Number);

  if (type === "patch") return `${a}.${b}.${c + 1}`;
  if (type === "minor") return `${a}.${b + 1}.0`;
  if (type === "major") return `${a + 1}.0.0`;

  return version;
}

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

const pkg = getPkg();

const screen = blessed.screen({
  smartCSR: true,
  title: "Release Tool",
});

const box = blessed.box({
  top: "center",
  left: "center",
  width: "70%",
  height: "70%",
  content: `Current version: ${pkg.version}\n\nChoose release type:\n\n[p] Patch\n[m] Minor\n[M] Major\n[q] Quit`,
  border: { type: "line" },
  style: {
    fg: "white",
    border: { fg: "blue" },
  },
});

screen.append(box);
screen.render();

function release(type) {
  const newVersion = bump(pkg.version, type);

  // update package.json
  pkg.version = newVersion;
  writePkg(pkg);

  // update tauri config
  const tauri = getTauri();
  tauri.version = newVersion;
  writeTauri(tauri);

  box.setContent(`Releasing v${newVersion}...\n\nCommitting and tagging...`);
  screen.render();

  try {
    run(`git add package.json src-tauri/tauri.conf.json`);
    run(`git commit -m "chore: release v${newVersion}"`);
    run(`git tag v${newVersion}`);
    run(`git push origin HEAD`);
    run(`git push origin v${newVersion}`);

    box.setContent(`Released v${newVersion} successfully.`);
  } catch (e) {
    box.setContent(`Release failed:\n${e.message}`);
  }

  screen.render();
}

screen.key(["p", "m", "M"], (ch) => {
  if (ch === "p") release("patch");
  if (ch === "m") release("minor");
  if (ch === "M") release("major");
});

screen.key(["q", "C-c"], () => process.exit(0));
