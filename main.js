const { app, BrowserWindow, ipcMain } = require("electron")

// Hardwarebeschleunigung ist aktiv!
const path = require("path")
const fs = require("fs")
const https = require("https")
const os = require("os")

const { Client } = require("minecraft-launcher-core")
const { microsoftLogin, clearAuthCache } = require("./login")

const launcher = new Client()

let mainWindow
let selectedRam = "4G"

const accountsFile = path.join(app.getPath("userData"), "accounts.json")

const PERFORMANCE_MODS = [
    { name: "Sodium",           id: "AANobbMI" },
    { name: "Lithium",          id: "gvQqBUqZ" },
    { name: "Ferrite Core",     id: "uXXizFIs" },
    { name: "Entity Culling",   id: "NNAgCjsB" },
    { name: "More Culling",     id: "51shyZVL" },
    { name: "Starlight",        id: "H8CaAYZC" },
    { name: "Fabric API",       id: "P7dR8mSH" },
    { name: "Cloth Config API", id: "9s6osm5g" },
    { name: "Iris Shaders",     id: "YL57xq9U" },
    { name: "Fabric Language Kotlin", id: "Ha28R6CL" },
]

const SHADOW_MOD = {
    name: "Shadow Client Mod",
    filename: "shadow-client-mod-1.0.0.jar",
    url: "https://www.dropbox.com/scl/fi/7g9dlvjfuw2pwkkpphapf/shadow-client-mod-1.0.0.jar?rlkey=4l8aoywf3iy1z4y1a0xywi4wu&st=vo14d6hs&dl=1"
}

function getVersionRoot(version, type) {
    return path.join(app.getPath("userData"), "versions", version, type)
}

function loadAccounts(){
    if(!fs.existsSync(accountsFile)) return []
    return JSON.parse(fs.readFileSync(accountsFile))
}

function saveAccounts(accounts){
    fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2))
}

function createWindow(){
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        resizable: true,
        fullscreen: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    mainWindow.loadFile("index.html")
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
    if(process.platform !== "darwin") app.quit()
})

ipcMain.on("update-ram", (event, ram) => {
    selectedRam = ram + "G"
})

ipcMain.handle("login", async () => {
    try {
        const session = await microsoftLogin()
        const accounts = loadAccounts()
        const existing = accounts.find(a => a.uuid === session.profile.id)
        if(!existing){
            accounts.push({
                name: session.profile.name,
                uuid: session.profile.id,
                access_token: session.token,
                client_token: "ShadowClient"
            })
        }
        saveAccounts(accounts)
        return {
            success: true,
            name: session.profile.name,
            uuid: session.profile.id,
            access_token: session.token,
            client_token: "ShadowClient"
        }
    } catch(err) {
        console.log(err)
        return { success: false }
    }
})

ipcMain.handle("logout", async () => {
    try {
        clearAuthCache()
        if(fs.existsSync(accountsFile)) {
            fs.unlinkSync(accountsFile)
            console.log("Accounts gelöscht")
        }
        return { success: true }
    } catch(err) {
        console.error("Logout Fehler:", err)
        return { success: false }
    }
})

ipcMain.handle("get-accounts", () => {
    return loadAccounts()
})

ipcMain.handle("remove-account", (event, uuid) => {
    let accounts = loadAccounts()
    accounts = accounts.filter(a => a.uuid !== uuid)
    saveAccounts(accounts)
    return accounts
})

ipcMain.handle("install-mod", async (event, { projectId, modName, version }) => {
    try {
        const versionRoot = getVersionRoot(version, "fabric")
        const modsDir = path.join(versionRoot, "mods")
        if(!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

        const params = new URLSearchParams()
        params.set("game_versions", JSON.stringify([version]))
        params.set("loaders", JSON.stringify(["fabric"]))
        const url = `https://api.modrinth.com/v2/project/${projectId}/version?${params.toString()}`
        const raw = await httpsGet(url)
        const versions = JSON.parse(raw)

        if(!versions || versions.length === 0) {
            return { success: false, error: `Keine kompatible Version für MC ${version} gefunden` }
        }

        const latest = versions[0]
        const file = latest.files.find(f => f.primary) || latest.files[0]

        if(!file) {
            return { success: false, error: "Keine Datei gefunden" }
        }

        const destPath = path.join(modsDir, file.filename)
        if(fs.existsSync(destPath)) {
            return { success: true, already: true }
        }

        await downloadFile(file.url, destPath)
        console.log(`[MOD] Installiert: ${modName} (${file.filename})`)
        return { success: true }
    } catch(err) {
        console.error("[MOD] Fehler:", err)
        return { success: false, error: err.message }
    }
})

ipcMain.handle("get-installed-mods", (event, { version }) => {
    try {
        const versionRoot = getVersionRoot(version, "fabric")
        const modsDir = path.join(versionRoot, "mods")
        if(!fs.existsSync(modsDir)) return []

        const files = fs.readdirSync(modsDir)
            .filter(f => f.endsWith(".jar"))
            .map(f => {
                const stat = fs.statSync(path.join(modsDir, f))
                return { filename: f, size: stat.size }
            })
        return files
    } catch(err) {
        return []
    }
})

ipcMain.handle("delete-mod", (event, { version, filename }) => {
    try {
        const versionRoot = getVersionRoot(version, "fabric")
        const modPath = path.join(versionRoot, "mods", filename)
        if(fs.existsSync(modPath)) {
            fs.unlinkSync(modPath)
            console.log(`[MOD] Gelöscht: ${filename}`)
        }
        return { success: true }
    } catch(err) {
        console.error("[MOD] Löschen fehlgeschlagen:", err)
        return { success: false, error: err.message }
    }
})

function httpsRequest(method, host, path, headers, body) {
    return new Promise((resolve, reject) => {
        const opts = { method, host, path, headers: { ...headers, "Content-Length": body ? String(body.length) : "0" } }
        const req = https.request(opts, res => {
            let data = ""
            res.on("data", chunk => data += chunk)
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data)
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`))
                }
            })
        })
        req.on("error", reject)
        req.end(body || undefined)
    })
}

ipcMain.handle("change-skin", async (event, { accessToken, skinData, skinUrl, variant, playerName }) => {
    try {
        variant = variant || "classic"

        if (skinData) {
            const base64 = skinData.replace(/^data:image\/png;base64,/, "")
            const buf = Buffer.from(base64, "base64")
            await uploadSkinMultipart(accessToken, buf, variant)
        } else if (skinUrl) {
            console.log("[SKIN] Upload via URL:", skinUrl)
            await uploadSkinUrl(accessToken, skinUrl, variant)
        } else if (playerName) {
            console.log("[SKIN] Löse Spieler-Skin auf für:", playerName)
            const uuidRaw = await httpsGet(`https://api.mojang.com/users/profiles/minecraft/${playerName}`)
            const uuidData = JSON.parse(uuidRaw)
            const uuid = uuidData.id
            if (!uuid) throw new Error("Spieler nicht gefunden: " + playerName)
            const profileRaw = await httpsGet(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`)
            const profile = JSON.parse(profileRaw)
            const texturesProp = profile.properties.find(p => p.name === "textures")
            if (!texturesProp) throw new Error("Keine Texturen im Profil gefunden")
            const textures = JSON.parse(Buffer.from(texturesProp.value, "base64").toString("utf8"))
            const resolvedUrl = textures.textures.SKIN && textures.textures.SKIN.url
            if (!resolvedUrl) throw new Error("Keine Skin-URL gefunden")
            console.log("[SKIN] Echte Skin-URL:", resolvedUrl)
            await uploadSkinUrl(accessToken, resolvedUrl, variant)
        } else {
            throw new Error("Kein Skin angegeben")
        }

        console.log("[SKIN] Skin erfolgreich geändert")
        return { success: true }
    } catch(err) {
        console.error("[SKIN] Fehler:", err)
        return { success: false, error: err.message }
    }
})

function uploadSkinUrl(accessToken, url, variant) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ variant, url }))
        const req = https.request({
            method: "POST",
            host: "api.minecraftservices.com",
            path: "/minecraft/profile/skins",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Content-Length": body.length
            }
        }, res => {
            let data = ""
            res.on("data", chunk => data += chunk)
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(data)
                else reject(new Error(`HTTP ${res.statusCode}: ${data}`))
            })
        })
        req.on("error", reject)
        req.end(body)
    })
}

function uploadSkinMultipart(accessToken, buffer, variant) {
    return new Promise((resolve, reject) => {
        const boundary = "ShadowBoundary" + Date.now()
        const CRLF = "\r\n"
        const head1 = Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="variant"${CRLF}${CRLF}${variant}${CRLF}`)
        const head2 = Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="skin.png"${CRLF}Content-Type: image/png${CRLF}${CRLF}`)
        const tail  = Buffer.from(`${CRLF}--${boundary}--${CRLF}`)
        const body  = Buffer.concat([head1, head2, buffer, tail])
        const req = https.request({
            method: "PUT",
            host: "api.minecraftservices.com",
            path: "/minecraft/profile/skins",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": body.length
            }
        }, res => {
            let data = ""
            res.on("data", chunk => data += chunk)
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(data)
                else reject(new Error(`HTTP ${res.statusCode}: ${data}`))
            })
        })
        req.on("error", reject)
        req.write(body)
        req.end()
    })
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const request = (u) => {
            https.get(u, { headers: { "User-Agent": "ShadowClient/1.0" } }, res => {
                if(res.statusCode === 301 || res.statusCode === 302) {
                    return request(res.headers.location)
                }
                let data = ""
                res.on("data", chunk => data += chunk)
                res.on("end", () => resolve(data))
            }).on("error", reject)
        }
        request(url)
    })
}

function httpsGetBuffer(url) {
    return new Promise((resolve, reject) => {
        const request = (u) => {
            https.get(u, { headers: { "User-Agent": "ShadowClient/1.0" } }, res => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return request(res.headers.location)
                }
                const chunks = []
                res.on("data", chunk => chunks.push(chunk))
                res.on("end", () => resolve(Buffer.concat(chunks)))
            }).on("error", reject)
        }
        request(url)
    })
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest)
        const request = (u) => {
            https.get(u, { headers: { "User-Agent": "ShadowClient/1.0" } }, res => {
                if(res.statusCode === 301 || res.statusCode === 302) {
                    file.close()
                    return resolve(downloadFile(res.headers.location, dest))
                }
                if(res.statusCode !== 200) {
                    file.close()
                    fs.unlink(dest, () => {})
                    return reject(new Error(`HTTP ${res.statusCode} für ${u}`))
                }
                res.pipe(file)
                file.on("finish", () => {
                    file.close(() => {
                        const size = fs.statSync(dest).size
                        if(size === 0) {
                            fs.unlink(dest, () => {})
                            reject(new Error(`Leere Datei: ${dest}`))
                        } else {
                            resolve()
                        }
                    })
                })
            }).on("error", err => {
                file.close()
                fs.unlink(dest, () => {})
                reject(err)
            })
        }
        request(url)
    })
}

async function downloadModrinthMod(modId, modName, mcVersion, modsDir) {
    const modParams = new URLSearchParams()
    modParams.set("game_versions", JSON.stringify([mcVersion]))
    modParams.set("loaders", JSON.stringify(["fabric"]))
    const url = `https://api.modrinth.com/v2/project/${modId}/version?${modParams.toString()}`
    const raw = await httpsGet(url)
    const versions = JSON.parse(raw)

    if(!versions || versions.length === 0) {
        console.log(`[MODS] Keine Version gefunden für ${modName} auf MC ${mcVersion}`)
        return false
    }

    const latest = versions[0]
    const file = latest.files.find(f => f.primary) || latest.files[0]

    if(!file) {
        console.log(`[MODS] Keine Datei gefunden für ${modName}`)
        return false
    }

    const destPath = path.join(modsDir, file.filename)

    if(fs.existsSync(destPath)) {
        console.log(`[MODS] ${modName} bereits installiert, überspringe`)
        return true
    }

    console.log(`[MODS] Downloading ${modName}: ${file.filename}`)
    await downloadFile(file.url, destPath)
    return true
}

async function downloadShadowMod(modsDir) {
    const destPath = path.join(modsDir, SHADOW_MOD.filename)
    if (fs.existsSync(destPath)) {
        console.log(`[MODS] ${SHADOW_MOD.name} bereits installiert, überspringe`)
        return true
    }
    console.log(`[MODS] Downloading ${SHADOW_MOD.name}: ${SHADOW_MOD.filename}`)
    await downloadFile(SHADOW_MOD.url, destPath)
    console.log(`[MODS] ${SHADOW_MOD.name} erfolgreich installiert`)
    return true
}

ipcMain.handle("install-fabric", async (event, { version }) => {
    try {
        const versionRoot = getVersionRoot(version, "fabric")
        if(!fs.existsSync(versionRoot)) fs.mkdirSync(versionRoot, { recursive: true })

        mainWindow.webContents.send("install-progress", { message: "Lade Fabric Loader Version...", percent: 5 })

        const loadersRaw = await httpsGet("https://meta.fabricmc.net/v2/versions/loader")
        const loaders = JSON.parse(loadersRaw)
        const stable = loaders.find(v => v.stable)
        const loaderVersion = stable ? stable.version : loaders[0].version

        mainWindow.webContents.send("install-progress", { message: `Fabric ${loaderVersion} gefunden...`, percent: 15 })

        const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderVersion}/profile/json`
        const profileRaw = await httpsGet(profileUrl)
        const profile = JSON.parse(profileRaw)
        const fabricVersionId = profile.id

        mainWindow.webContents.send("install-progress", { message: "Speichere Fabric Profil...", percent: 25 })

        const versionDir = path.join(versionRoot, "versions", fabricVersionId)
        const fabricJson = path.join(versionDir, `${fabricVersionId}.json`)
        if (fs.existsSync(fabricJson)) {
            console.log(`[FABRIC] Bereits installiert: ${fabricVersionId}`)
            mainWindow.webContents.send("install-progress", { message: "Fabric bereits installiert!", percent: 100 })
            return { success: true, loaderVersion, versionId: fabricVersionId, cached: true }
        }
        if(!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true })
        fs.writeFileSync(path.join(versionDir, `${fabricVersionId}.json`), JSON.stringify(profile, null, 2))

        mainWindow.webContents.send("install-progress", { message: "Lade Fabric Libraries...", percent: 35 })

        const librariesDir = path.join(versionRoot, "libraries")
        if(!fs.existsSync(librariesDir)) fs.mkdirSync(librariesDir, { recursive: true })

        const libs = profile.libraries || []
        for(let i = 0; i < libs.length; i++) {
            const lib = libs[i]
            const percent = 35 + Math.floor((i / libs.length) * 25)
            mainWindow.webContents.send("install-progress", {
                message: `Library ${i + 1}/${libs.length}: ${lib.name}`,
                percent
            })

            if(lib.downloads && lib.downloads.artifact) {
                const artifact = lib.downloads.artifact
                const libPath = path.join(librariesDir, artifact.path)
                const libDir = path.dirname(libPath)
                if(!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })
                if(!fs.existsSync(libPath)) await downloadFile(artifact.url, libPath)
            } else if(lib.name) {
                const parts = lib.name.split(":")
                const [group, artifact, ver] = parts
                const groupPath = group.replace(/\./g, "/")
                const jarName = `${artifact}-${ver}.jar`
                const mavenPath = `${groupPath}/${artifact}/${ver}/${jarName}`
                const libPath = path.join(librariesDir, mavenPath)
                const libDir = path.dirname(libPath)
                if(!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })
                if(!fs.existsSync(libPath)) {
                    for(const base of [
                        "https://maven.fabricmc.net/",
                        "https://repo1.maven.org/maven2/"
                    ]) {
                        try { await downloadFile(base + mavenPath, libPath); break } catch(e) {}
                    }
                }
            }
        }

        const modsDir = path.join(versionRoot, "mods")
        if(!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

        for(let i = 0; i < PERFORMANCE_MODS.length; i++) {
            const mod = PERFORMANCE_MODS[i]
            const percent = 60 + Math.floor((i / PERFORMANCE_MODS.length) * 38)
            mainWindow.webContents.send("install-progress", {
                message: `Installiere Mod ${i + 1}/${PERFORMANCE_MODS.length}: ${mod.name}`,
                percent
            })
            try {
                await downloadModrinthMod(mod.id, mod.name, version, modsDir)
            } catch(e) {
                console.error(`[MODS] Fehler bei ${mod.name}:`, e.message)
            }
        }

        mainWindow.webContents.send("install-progress", { message: `Installiere Shadow Client Mod...`, percent: 99 })
        try {
            await downloadShadowMod(modsDir)
        } catch(e) {
            console.error(`[MODS] Fehler bei Shadow Client Mod:`, e.message)
        }

        mainWindow.webContents.send("install-progress", { message: "Alles installiert! Starte Minecraft...", percent: 100 })

        return { success: true, loaderVersion, versionId: fabricVersionId }

    } catch(err) {
        console.error("Fabric Fehler:", err)
        return { success: false, error: err.message }
    }
})

ipcMain.handle("play", async (event, data) => {

    if (data.type === "fabric") {
        try {
            const modsDir = path.join(getVersionRoot(data.version, "fabric"), "mods")
            if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })
            await downloadShadowMod(modsDir)
        } catch(e) {
            console.error("[MODS] Shadow Mod Vorab-Check fehlgeschlagen:", e.message)
        }
    }

    const versionRoot = getVersionRoot(data.version, data.type === "fabric" ? "fabric" : "vanilla")
    if(!fs.existsSync(versionRoot)) fs.mkdirSync(versionRoot, { recursive: true })

    const opts = {
        authorization: {
            access_token: data.accessToken,
            client_token: data.clientToken,
            uuid: data.uuid,
            name: data.username
        },
        root: versionRoot,
        version: {
            number: data.version,
            type: data.type === "fabric" ? "fabric" : "release",
            custom: data.fabricVersionId || undefined
        },
        memory: {
            max: selectedRam,
            min: "2G"
        }
    }

    launcher.launch(opts)

    launcher.on("download-status", (e) => {
        const percent = e.total ? Math.floor((e.current / e.total) * 100) : 0
        mainWindow.webContents.send("mc-download-progress", {
            message: `Downloading: ${e.name}`,
            percent
        })
    })

    launcher.on("progress", (e) => {
        const percent = e.total ? Math.floor((e.task / e.total) * 100) : 0
        mainWindow.webContents.send("mc-download-progress", {
            message: `${e.type}: ${e.task}/${e.total}`,
            percent
        })
    })

    launcher.on("ready", () => {
        mainWindow.webContents.send("mc-ready")
        mainWindow.minimize()
    })

    launcher.on("debug", (e) => console.log("[MCLC]:", e))
    launcher.on("data", (e) => console.log(e))

    launcher.on("close", () => {
        mainWindow.webContents.send("mc-closed")
    })
})