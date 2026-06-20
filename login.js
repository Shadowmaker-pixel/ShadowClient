const { Authflow } = require("prismarine-auth")
const { app } = require("electron")
const fs = require("fs")
const os = require("os")
const path = require("path")

const downloads = path.join(os.homedir(), "Downloads")
const logFile = path.join(downloads, "shadow_terminal.txt")

// FIX: __dirname zeigt in einer .asar auf einen virtuellen Pfad (kein echtes Verzeichnis).
// app.getPath("userData") ist der korrekte, beschreibbare Pfad auf allen Plattformen.
// Windows: C:\Users\<name>\AppData\Roaming\Shadow Client
// Linux:   ~/.config/Shadow Client
const CACHE_DIR = path.join(app.getPath("userData"), ".auth")

let logs = []

function writeLog(line) {
    logs.push(line)
    try {
        fs.writeFileSync(logFile, logs.join("\n"))
    } catch(e) {}
}

const originalLog = console.log
console.log = function(...args) {
    const text = args.join(" ")
    writeLog(text)
    originalLog.apply(console, args)
}

const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = function(chunk, encoding, callback) {
    const text = chunk.toString()
    writeLog(text.trim())
    return originalWrite(chunk, encoding, callback)
}

const originalErrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = function(chunk, encoding, callback) {
    const text = chunk.toString()
    writeLog(text.trim())
    return originalErrWrite(chunk, encoding, callback)
}

async function microsoftLogin() {
    writeLog("=== Shadow Client ===")
    writeLog("Login gedrückt...")
    writeLog(`Auth Cache Pfad: ${CACHE_DIR}`)

    // Sicherstellen dass das Verzeichnis existiert
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
    }

    const flow = new Authflow("ShadowClient", CACHE_DIR)

    const session = await flow.getMinecraftJavaToken({
        fetchProfile: true
    })

    // FIX: Prüfe ob session und profile vorhanden sind
    if (!session) {
        throw new Error("Login fehlgeschlagen: Keine Session erhalten.")
    }

    if (!session.profile) {
        throw new Error(
            "Kein Minecraft-Profil gefunden. " +
            "Bitte stelle sicher, dass der Microsoft-Account eine Minecraft Java Edition Lizenz besitzt."
        )
    }

    if (!session.profile.name) {
        throw new Error(
            "Minecraft-Profil unvollständig: Kein Spielername gefunden. " +
            "Bitte stelle sicher, dass ein Minecraft-Benutzername eingerichtet ist."
        )
    }

    writeLog("Login erfolgreich!")
    writeLog(`Spieler: ${session.profile.name}`)

    return session
}

function clearAuthCache() {
    try {
        if(fs.existsSync(CACHE_DIR)) {
            fs.rmSync(CACHE_DIR, { recursive: true, force: true })
            console.log("Auth Cache gelöscht:", CACHE_DIR)
        }
        const oldAuth = path.join(__dirname, "auth")
        if(fs.existsSync(oldAuth)) {
            fs.rmSync(oldAuth, { recursive: true, force: true })
            console.log("Alter Auth Cache gelöscht:", oldAuth)
        }
    } catch(e) {
        console.error("Cache löschen fehlgeschlagen:", e)
    }
}

module.exports = { microsoftLogin, clearAuthCache }
