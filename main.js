const { app, BrowserWindow, ipcMain } = require("electron")

// GPU Fehler verhindern
app.disableHardwareAcceleration()
app.commandLine.appendSwitch("disable-gpu")

const path = require("path")
const fs = require("fs")
const os = require("os")

const { Authflow } = require("prismarine-auth")
const { Client } = require("minecraft-launcher-core")

const launcher = new Client()

let mainWindow

function createWindow(){

    mainWindow = new BrowserWindow({

        width:1200,
        height:800,
        resizable:true,
        fullscreen:true,
        autoHideMenuBar:true,

        webPreferences:{
            nodeIntegration:true,
            contextIsolation:false
        }

    })

    mainWindow.loadFile("index.html")

    console.log("Launcher gestartet")

}

app.whenReady().then(createWindow)

app.on("window-all-closed",()=>{
    if(process.platform !== "darwin") app.quit()
})

/* ======================
 * MICROSOFT LOGIN
 = =*==================== */

ipcMain.handle("login", async ()=>{

    console.log("Login gedrückt")

    try{

        const flow = new Authflow("ShadowClient")

        const session = await flow.getMinecraftJavaToken({
            fetchProfile:true
        })

        console.log("[msa] Signed in with Microsoft")
        console.log("Eingeloggt als:",session.profile.name)

        return {
            success:true,
            name:session.profile.name,
            uuid:session.profile.id,
            access_token:session.token,
            client_token:"ShadowClient"
        }

    }catch(err){

        console.log("Login Fehler:",err)
        return {success:false}

    }

})

/* ======================
 * MINECRAFT START
 = =*==================== */

ipcMain.handle("play", async (event, data)=>{

    console.log("Minecraft starten")
    console.log("User:",data.username)
    console.log("Version:",data.version)

    const versionRoot = path.join(
        __dirname,
        "versions",
        data.version,
        "minecraft"
    )

    if(!fs.existsSync(versionRoot)){
        fs.mkdirSync(versionRoot,{recursive:true})
    }

    // prüfen ob Version schon installiert
    const jarPath = path.join(
        versionRoot,
        "versions",
        data.version,
        data.version + ".jar"
    )

    const installed = fs.existsSync(jarPath)

    if(installed){
        console.log("Minecraft Version bereits installiert → starte direkt")
    }else{
        console.log("Minecraft Version nicht installiert → Download startet")
    }

    const opts = {

        authorization:{
            access_token:data.accessToken,
            client_token:data.clientToken,
            uuid:data.uuid,
            name:data.username
        },

        root: versionRoot,

        version:{
            number:data.version,
            type:"release"
        },

        memory:{
            max:"8G",
            min:"2G"
        }

    }

    launcher.launch(opts)

    launcher.on("debug",(e)=>console.log("[MCLC]:",e))
    launcher.on("data",(e)=>console.log(e))

})
