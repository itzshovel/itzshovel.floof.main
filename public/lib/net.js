import { canvas, gameScale, renderTerrain, renderTerrainForMap, SpookyOverlay } from "./canvas.js";
import { Reader, Writer, SERVER_BOUND, CLIENT_BOUND, ENTITY_FLAGS, ENTITY_MODIFIER_FLAGS, decodeEverything, Drawing, DEV_CHEAT_IDS, PetalConfig, MobConfig, PetalTier, getTerrain, terrains, BIOME_TYPES, loadTerrains } from "./protocol.js";
import { StarfishData } from "./renders.js";
import * as util from "./util.js";

function getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let browserName = "unknown";
    let browserVersion = "unknown";

    if (userAgent.includes("Firefox")) {
        browserName = "Firefox";
        browserVersion = parseInt(userAgent.match(/Firefox\/([\d]+)/)?.[1]);
    } else if (userAgent.includes("Edg")) {
        browserName = "Edge";
        browserVersion = parseInt(userAgent.match(/Edg\/([\d]+)/)?.[1]);
    } else if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
        browserName = "Chrome";
        browserVersion = parseInt(userAgent.match(/Chrome\/([\d]+)/)?.[1]);
    } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
        browserName = "Safari";
        browserVersion = parseInt(userAgent.match(/Version\/([\d]+)/)?.[1]);
    } else if (userAgent.includes("OPR")) {
        browserName = "Opera";
        browserVersion = parseInt(userAgent.match(/OPR\/([\d]+)/)?.[1]);
    }

    return { name: browserName, version: browserVersion };
}

function getOSInfo() {
    const agent = navigator.userAgent;
    const data = navigator.userAgentData;
    const platform = navigator.platform;

    const platformRegex = {
        "Windows": /Win/i,
        "Mac OS": /Mac/i,
        "iOS": /iPhone|iPad|iPod/i,
        "Android": /Android/i,
        "Linux": /Linux/i,
        "Unix": /X11/i
    };

    const agentRegex = {
        "Windows": /Windows/i,
        "Mac OS": /Mac OS/i,
        "iOS": /like Mac OS/i,
        "Android": /Android/i,
        "Linux": /Linux/i,
        "Unix": /Unix/i
    };

    const userAgentDataRegex = {
        "Windows": /Windows/i,
        "Mac OS": /Mac OS/i,
        "iOS": /like Mac OS/i,
        "Android": /Android/i,
        "Linux": /Linux/i,
        "Unix": /Unix/i
    };

    let os = "Unknown";

    for (const [name, regex] of Object.entries(platformRegex)) {
        if (regex.test(platform)) {
            os = name;
            break;
        }
    }

    for (const [name, regex] of Object.entries(agentRegex)) {
        if (regex.test(agent)) {
            os = name;
            break;
        }
    }

    if (data) {
        for (const [name, regex] of Object.entries(userAgentDataRegex)) {
            if (regex.test(data.platform)) {
                os = name;
                break;
            }
        }
    }

    return os;
}

function extractImportantGPUInfo(gpuName) {
    const nvidiaPattern = /NVIDIA\s+(GeForce|Quadro|RTX|GTX)\s+([A-Za-z0-9\s]+)/i;
    const amdPattern = /AMD\s+(Radeon|RX)\s+([A-Za-z0-9\s]+)/i;
    const intelPattern = /Intel\s+(Iris|UHD|Xe)\s+([A-Za-z0-9\s]+)/i;

    if (nvidiaPattern.test(gpuName)) {
        const [, series, model] = gpuName.match(nvidiaPattern);
        return `NVIDIA ${series} ${model.trim()}`;
    } else if (amdPattern.test(gpuName)) {
        const [, series, model] = gpuName.match(amdPattern);
        return `AMD ${series} ${model.trim()}`;
    } else if (intelPattern.test(gpuName)) {
        const [, series, model] = gpuName.match(intelPattern);
        return `Intel ${series} ${model.trim()}`;
    }

    return "Other";
}

async function benchmarkTest() {
    return new Promise((resolve) => {
        const workerCode = `
            onmessage = function() {
                let startTime = performance.now();
                for (let i = 0; i < 1e7; i++) {}
                let endTime = performance.now();
                postMessage(endTime - startTime);
            };
        `;

        const blob = new Blob([workerCode], { type: "application/javascript" });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = (e) => {
            resolve(e.data);
            worker.terminate();
        };

        worker.postMessage(null);
    });
}

async function getAnalyticsData() {
    const gl = document.createElement("canvas").getContext("webgl") || document.createElement("canvas").getContext("experimental-webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const browserInfo = getBrowserInfo();

    const output = {
        screen: `${screen.width}x${screen.height}`,
        hardware: {
            gl: +!!window.WebGLRenderingContext,
            gl2: +!!window.WebGL2RenderingContext,
            minCores: navigator.hardwareConcurrency,
            minMem: navigator.deviceMemory ?? 0,
            gpu: extractImportantGPUInfo(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "unknown"),
            os: getOSInfo(),
            bench: await benchmarkTest()
        },
        browser: {
            name: browserInfo.name,
            version: browserInfo.version
        },
        locale: navigator.language,
        tzOff: -(new Date().getTimezoneOffset() / 60),
        dst: +(new Date().getTimezoneOffset() < Math.max(new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset(), new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset())),
        isMobile: +(/Android|webOS|iPhone|iPad|iPod|BlackBerry|android|mobi/i.test(navigator.userAgent))
    };

    const userAgentData = navigator.userAgentData;

    if (userAgentData) {
        if (userAgentData.brands.length > 0) {
            const brand = userAgentData.brands.find(b => b.version == output.browser.version)?.brand;

            if (brand) {
                output.browser.name = brand;
            }
        }

        output.isMobile = +userAgentData.mobile;
    }

    return output;
}

async function encodeAnalytics() {
    const data = await getAnalyticsData();
    return btoa(JSON.stringify(data));
}

const analyticalData = encodeURIComponent(await encodeAnalytics());

export async function loadUUID() {
    const storageID = localStorage.getItem("uuid");
    let existing = false;

    if (storageID) {
        const [id, expiresAt] = storageID.split(":");

        if (Date.now() < Number(expiresAt)) {
            existing = id;
        }
    }

    const data = await fetch(util.SERVER_URL + "/uuid/get?existing=" + existing).then(r => r.json());

    if (!data.ok) {
        throw new Error("Failed to get UUID data");
    }

    localStorage.setItem("uuid", data.uuid + ":" + (Date.now() + 1E3 * 60 * 60 * 24));

    return data.uuid;
}

export const UUID = await loadUUID();
console.log("UUID", UUID);

export async function findLobbies() {
    const response = await fetch(util.SERVER_URL + "/lobby/list");
    const lobbies = await response.json();
    return lobbies;
}

class ModdingAPI {
    #jobs = new Map();
    #jobID = 0;

    /** @type {BroadcastChannel|null} */
    #channel = null;

    constructor() {
        this.#channel = new BroadcastChannel("floofModdingAPI");
        this.#channel.onmessage = e => this.#handleFloofModdingAPI(e.data);

        console.log("Modding API initialized");

        window.floof = this;
    }

    #handleFloofModdingAPI(data) {
        const job = this.#jobs.get(data[0]);

        if (!job) {
            throw new Error("Invalid job ID");
        }

        if (data[2] !== null) { // transferrable type
            let obj = new PetalConfig("", 0, 0, 0);

            switch (data[2]) {
                case 0: // PetalConfig
                    obj = Object.assign(obj, structuredClone(data[1].data));

                    for (const key in data[1].data) {
                        const value = structuredClone(data[1].data[key]);

                        switch (key) {
                            case "drawing":
                                obj[key] = Object.assign(new Drawing(), value);
                                break;
                            case "tiers":
                                for (let i = 0; i < value.length; i++) {
                                    obj[key][i] = Object.assign(new PetalTier(0, 0, 0), value[i]);
                                }
                                break;
                        }
                    }
                    break;
            }

            data[1].data = obj;
        }

        job(data[1]);
    }

    #askModdingAPI(...args) {
        return new Promise(resolve => {
            const id = this.#jobID++;
            this.#jobs.set(id, resolve);
            this.#channel.postMessage([id, ...args]);
        });
    }

    syncPetalIndex(name) {
        return state.petalConfigs.findIndex(p => p.name === name);
    }

    syncMobIndex(name) {
        return state.mobConfigs.findIndex(m => m.name === name);
    }

    syncRarityIndex(name) {
        return state.tiers.findIndex(t => t.name === name);
    }

    syncNextAvailablePetalIndex() {
        return state.petalConfigs.length;
    }

    syncNextAvailableMobIndex() {
        return state.mobConfigs.length;
    }

    help() {
        window.open("/moddingAPI/index.html", "_blank");
    }

    get Drawing() {
        return Drawing;
    }

    get PetalConfig() {
        return PetalConfig;
    }

    get MobConfig() {
        return MobConfig;
    }

    async spawnMob(index, rarity) {
        if (typeof index === "string") {
            index = this.syncMobIndex(index);

            if (index === -1) {
                return {
                    ok: false,
                    message: "Invalid mob name",
                    data: null
                };
            }
        }

        if (typeof rarity === "string") {
            rarity = this.syncRarityIndex(rarity);

            if (rarity === -1) {
                return {
                    ok: false,
                    message: "Invalid rarity name",
                    data: null
                };
            }
        }

        return await this.#askModdingAPI("spawnMob", index, rarity);
    }

    async setRoomInfo(dynamic, width, height, mobCount, currentWave) {
        return await this.#askModdingAPI("setRoomInfo", dynamic, width, height, mobCount, currentWave);
    }

    async getRoomInfo() {
        return await this.#askModdingAPI("getRoomInfo");
    }

    async getPlayers() {
        return await this.#askModdingAPI("getPlayers");
    }

    async getMobs() {
        return await this.#askModdingAPI("getMobs");
    }

    async getPetalInfo(index) {
        if (typeof index === "string") {
            index = this.syncPetalIndex(index);

            if (index === -1) {
                return {
                    ok: false,
                    message: "Invalid petal name",
                    data: null
                };
            }
        }

        if (typeof index !== "number" || state.petalConfigs[index] === undefined) {
            return {
                ok: false,
                message: "Index must be a number pointing to an existing petal",
                data: null
            };
        }

        return await this.#askModdingAPI("getPetalInfo", index);
    }

    async createCustomPetal(options) {
        if (!(options instanceof PetalConfig)) {
            return {
                ok: false,
                message: "Options must be a PetalConfig object",
                data: null
            };
        }

        if (options.drawing) {
            options.drawing = options.drawing.toString();
        } else {
            return {
                ok: false,
                message: "Drawing is a required option",
                data: null
            };
        }

        return await this.#askModdingAPI("createCustomPetal", options);
    }

    async editPetal(options) {
        if (!(options instanceof PetalConfig)) {
            return {
                ok: false,
                message: "Options must be a PetalConfig object",
                data: null
            };
        }

        if (options.drawing) {
            options.drawing = options.drawing.toString();
        }

        return await this.#askModdingAPI("editPetal", options);
    }

    async deletePetal(index) {
        if (typeof index === "string") {
            index = this.syncPetalIndex(index);

            if (index === -1) {
                return {
                    ok: false,
                    message: "Invalid petal name",
                    data: null
                };
            }
        }

        if (typeof index !== "number" || state.petalConfigs[index] === undefined) {
            return {
                ok: false,
                message: "Index must be a number pointing to an existing petal",
                data: null
            };
        }

        return await this.#askModdingAPI("deletePetal", index);
    }

    async setSlot(clientID, slotID, index, rarity) {
        if (typeof index === "string") {
            index = this.syncPetalIndex(index);

            if (index === -1) {
                return {
                    ok: false,
                    message: "Invalid petal name",
                    data: null
                };
            }
        }

        if (typeof rarity === "string") {
            rarity = this.syncRarityIndex(rarity);

            if (rarity === -1) {
                return {
                    ok: false,
                    message: "Invalid rarity name",
                    data: null
                };
            }
        }

        return await this.#askModdingAPI("setSlot", clientID, slotID, index, rarity);
    }

    async setSlotAmount(clientID, amount) {
        return await this.#askModdingAPI("setSlotAmount", clientID, amount);
    }

    async spawnAIPlayer(rarity, level) {

        if (typeof rarity === "string") {
            rarity = this.syncRarityIndex(rarity);

            if (rarity === -1) {
                return {
                    ok: false,
                    message: "Invalid rarity name",
                    data: null
                };
            }
        }

        return await this.#askModdingAPI("spawnAIPlayer", rarity, level);
    }
}

export function createServer(name, gamemode, modded, isPrivate, biome) {
    let biomeInt = 0;

    switch (biome) {
        case "default":
            biomeInt = BIOME_TYPES.DEFAULT;
            break;
        case "garden":
            biomeInt = BIOME_TYPES.GARDEN;
            break;
        case "desert":
            biomeInt = BIOME_TYPES.DESERT;
            break;
        case "ocean":
            biomeInt = BIOME_TYPES.OCEAN;
            break;
        case "antHell":
            biomeInt = BIOME_TYPES.ANT_HELL;
            break;
        case "sewers":
            biomeInt = BIOME_TYPES.SEWERS;
            break;
        case "hell":
            biomeInt = BIOME_TYPES.HELL;
            break;
        case "halloween":
            if (util.isHalloween) {
                biomeInt = BIOME_TYPES.HALLOWEEN;
                break;
            } else {
                return new Promise(resolve => resolve({
                    ok: false,
                    error: "Halloween biome is not available"
                }));
            }
        case "dark_forest":
            biomeInt = BIOME_TYPES.DARK_FOREST
            break;
        default:
            return new Promise(resolve => resolve({
                ok: false,
                error: "Invalid biome"
            }));
    }

    return new Promise(resolve => {
        const timeout = setTimeout(() => resolve({
            ok: false,
            error: "Timeout error"
        }), 5000);

        const socket = new WebSocket(`${util.SERVER_URL.replace("http", "ws")}/ws/lobby?gameName=${name}&isModded=${modded ? "yes" : "no"}&isPrivate=${isPrivate ? "yes" : "no"}&gamemode=${gamemode}&biome=${biomeInt}&analytics=${analyticalData}`);
        socket.binaryType = "arraybuffer";

        socket.onopen = () => {
            console.log("Connected to server");

            const worker = new Worker("./server/index.js", { type: "module" });
            worker.postMessage(["start", gamemode, modded, UUID, biomeInt]);

            socket.onmessage = event => {
                const data = new Uint8Array(event.data);

                if (data[0] === 255) {
                    clearTimeout(timeout);

                    const ok = data[1] === 1;

                    if (!ok) {
                        resolve({
                            ok: false,
                            error: "Request rejected by server: " + new TextDecoder().decode(data.slice(2, -1))
                        });
                    }

                    resolve({
                        ok: true,
                        party: new TextDecoder().decode(data.slice(2, -1)),
                        worker: worker,
                        socket: socket
                    });
                    return;
                }

                worker.postMessage(data);
            }

            worker.onmessage = ({ data }) => {
                if (socket.readyState !== WebSocket.OPEN) {
                    return;
                }

                socket.send(data);
            }

            socket.onclose = () => {
                console.log("Disconnected from server");
                worker.terminate();
            }

            if (modded) {
                new ModdingAPI();
            }
        }
    });
}

export class ClientEntity {
    constructor(id) {
        this.id = id;

        // Display data
        this.x = 0;
        this.y = 0;
        this.size = 1;
        this.facing = 0;
        this.hit = false;

        // Real data to be interpolated
        this.realX = 0;
        this.realY = 0;
        this.realSize = 1;
        this.realFacing = 0;
    }

    interpolate() {
        this.x = util.lerp(this.x, this.realX, state.interpolationFactor);
        this.y = util.lerp(this.y, this.realY, state.interpolationFactor);
        this.size = util.lerp(this.size, this.realSize, state.interpolationFactor);
        this.facing = util.lerpAngle(this.facing, this.realFacing, state.interpolationFactor);
    }
}

export class ClientPlayer extends ClientEntity {
    constructor(id) {
        super(id);
        this.name = "";
        this.nameColor = "#FFFFFF";
        this.healthRatio = 1;
        this.shieldRatio = 0;
        this.realHealthRatio = 1;
        this.realShieldRatio = 0;
        this.rarity = 0;
        this.level = 0;

        this.mood = 0;
        this.mouthDip = 0;
        this.attack = false;
        this.defend = false;
        this.poisoned = false;
        this.wearing = 0;

        this.team = 0;

        this.lastHealthLoweredAt = 0;
        this.secondaryHealthBar = 0;
    }

    interpolate() {
        super.interpolate();

        if (Math.abs(this.realHealthRatio - this.healthRatio) > .01 && this.healthRatio > this.realHealthRatio) {
            this.lastHealthLoweredAt = performance.now();
        }

        this.secondaryHealthBar = Math.max(this.healthRatio, this.secondaryHealthBar);

        if (performance.now() - this.lastHealthLoweredAt > 256) {
            this.secondaryHealthBar = util.lerp(this.secondaryHealthBar, this.healthRatio, state.interpolationFactor * .75);
        }

        this.healthRatio = util.lerp(this.healthRatio, this.realHealthRatio, state.interpolationFactor);
        this.shieldRatio = util.lerp(this.shieldRatio, this.realShieldRatio, state.interpolationFactor);
    }
}

export class ClientPetal extends ClientEntity {
    constructor(id) {
        super(id);
        this.index = 0;
    }
}

export class ClientMob extends ClientEntity {
    constructor(id) {
        super(id);
        this.index = 0;
        this.rarity = 0;
        this.attack = false;
        this.poisoned = false;
        this.friendly = false;
        this.healthRatio = 1;
        this.realHealthRatio = 1;

        /** @type {StarfishData|undefined} */
        this.extraData = undefined;

        this.lastHealthLoweredAt = 0;
        this.secondaryHealthBar = 0;
    }

    interpolate() {
        super.interpolate();

        if (Math.abs(this.realHealthRatio - this.healthRatio) > .01 && this.healthRatio > this.realHealthRatio) {
            this.lastHealthLoweredAt = performance.now();
        }

        this.secondaryHealthBar = Math.max(this.healthRatio, this.secondaryHealthBar);

        if (performance.now() - this.lastHealthLoweredAt > 256) {
            this.secondaryHealthBar = util.lerp(this.secondaryHealthBar, this.healthRatio, state.interpolationFactor * .75);
        }

        this.healthRatio = util.lerp(this.healthRatio, this.realHealthRatio, state.interpolationFactor);

        if (this.extraData instanceof StarfishData) {
            this.extraData.update(this.healthRatio);
        }

        if (this.extraData instanceof Array) {
            for (const body of this.extraData) {
                body.x = util.lerp(body.x, body.realX, state.interpolationFactor);
                body.y = util.lerp(body.y, body.realY, state.interpolationFactor);
            }
        }
    }
}

export class ClientMarker {
    constructor(id) {
        this.id = id;
        this.x = 0;
        this.y = 0;
        this.size = 1;
        this.creation = 0;
        this.timer = 0;
    }

    get tick() {
        return (Date.now() - this.creation) / this.timer;
    }
}

export class ClientLightning {
    static TIME_ALIVE = 1E3;

    constructor(id) {
        this.id = id;
        /** @type {{x:number,y:number}[]} */
        this.points = [];

        this.tick = performance.now();
    }

    improvePoints() {
        const oldPoints = structuredClone(this.points);
        const points = [];
        const pointsBetweenPoints = 6;

        for (let i = 0; i < oldPoints.length - 1; i++) {
            const p1 = oldPoints[i];
            const p2 = oldPoints[i + 1];

            points.push(p1);

            for (let j = 1; j < pointsBetweenPoints; j++) {
                // Add some jaggedness
                const x = util.lerp(p1.x, p2.x, j / pointsBetweenPoints) + (Math.random() - .5) * 50;
                const y = util.lerp(p1.y, p2.y, j / pointsBetweenPoints) + (Math.random() - .5) * 50;
                points.push({ x, y });
            }
        }

        points.push(oldPoints[oldPoints.length - 1]);

        this.points = points;
    }

    get alpha() {
        const n = performance.now();
        return n - this.tick > ClientLightning.TIME_ALIVE ? 0 : 1 - (n - this.tick) / ClientLightning.TIME_ALIVE;
    }
}

export class ChatMessage {
    constructor(type, ...args) {
        this.type = type;

        switch (type) {
            case 0: // Chat
                this.username = args[0];
                this.message = args[1];
                this.color = args[2];

                this.completeMessage = this.username + ": " + this.message;
                break;
            case 1: // System
                this.message = args[0];
                this.color = args[1];
                this.completeMessage = this.message;
                break;
        }

        this.y = 300;
        this.ticker = 0;

        ChatMessage.messages.push(this);
    }

    /**
     * @type {ChatMessage[]}
     */
    static messages = [];

    static showInput = false;
    static element = document.getElementById("chatInput");

    static send() {
        const message = ChatMessage.element.value.trim();

        if (message.length > 0) {
            state.socket?.talk(SERVER_BOUND.CHAT_MESSAGE, message);
            ChatMessage.element.value = "";
        }

        ChatMessage.showInput = false;
    }

}

new ChatMessage(1, "Welcome to the game!", "#FFFFFF");

export function sendChatMessage(m) {
    if (typeof m !== "string") return false;
    m = m.trim();
    if (!m.length) return false;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
    state.socket.talk(SERVER_BOUND.CHAT_MESSAGE, m);
    return true;
}

const _chatListeners = new Set();
export function onChatMessage(cb) {
    if (typeof cb !== "function") return function () {};
    _chatListeners.add(cb);
    return function () { _chatListeners.delete(cb); };
}

const _captureQueue = [];
export function captureChatMessage(predicate, opts) {
    if (typeof opts === "number") opts = { timeoutMs: opts };
    opts = opts || {};
    const timeoutMs = opts.timeoutMs || 3000;
    const isMulti =
        (typeof opts.count === "number" && opts.count > 1) ||
        typeof opts.idleMs === "number";

    return new Promise(function (resolve) {
        const entry = {
            predicate: predicate,
            isMulti: isMulti,
            count: opts.count,
            idleMs: opts.idleMs,
            collected: [],
        };
        const finalize = function () {
            clearTimeout(entry.overallTimer);
            clearTimeout(entry.idleTimer);
            const idx = _captureQueue.indexOf(entry);
            if (idx !== -1) _captureQueue.splice(idx, 1);
            if (isMulti) resolve(entry.collected.slice());
            else resolve(entry.collected[0] || null);
        };
        entry.finalize = finalize;
        entry.overallTimer = setTimeout(finalize, timeoutMs);
        _captureQueue.push(entry);
    });
}

const _origAllMessagesPush = ChatMessage.allMessages.push.bind(ChatMessage.allMessages);
ChatMessage.allMessages.push = function () {
    const r = _origAllMessagesPush.apply(ChatMessage.allMessages, arguments);
    for (let i = 0; i < arguments.length; i++) {
        const m = arguments[i];
        if (!m) continue;
        const evt = { type: m.type, username: m.username, message: m.message, color: m.color };

        let captured = false;
        for (let f = 0; f < _captureQueue.length; f++) {
            const entry = _captureQueue[f];
            try {
                if (entry.predicate(evt)) {
                    entry.collected.push(evt);
                    captured = true;
                    if (!entry.isMulti) {
                        entry.finalize();
                    } else {
                        if (typeof entry.idleMs === "number") {
                            clearTimeout(entry.idleTimer);
                            entry.idleTimer = setTimeout(entry.finalize, entry.idleMs);
                        }
                        if (typeof entry.count === "number" && entry.collected.length >= entry.count) {
                            entry.finalize();
                        }
                    }
                    break;
                }
            } catch (e) {
                console.error("[captureChatMessage] predicate error:", e);
            }
        }

        if (captured) {
            const ai = ChatMessage.allMessages.indexOf(m);
            if (ai !== -1) ChatMessage.allMessages.splice(ai, 1);
            const mi = ChatMessage.messages.indexOf(m);
            if (mi !== -1) ChatMessage.messages.splice(mi, 1);
            continue;
        }

        _chatListeners.forEach(function (fn) {
            try { fn(evt); } catch (e) { console.error("[onChatMessage] listener error:", e); }
        });
    }
    return r;
};

export class ClientSocket extends WebSocket {
    static Listener = class Listener {
        /** @param {ClientSocket} socket */
        constructor(socket) {
            this.jobID = 0;
            this.socket = socket;

            this.jobs = new Map();
        }

        wait(data) {
            return new Promise(resolve => {
                const id = this.jobID++;
                this.socket.talk(SERVER_BOUND.DEV_CHEAT, { promiseID: id, ...data });
                this.jobs.set(id, resolve);
            });
        }

        handle(id, data) {
            if (!this.jobs.has(id)) {
                return false;
            }

            this.jobs.get(id)(data);
            this.jobs.delete(id);
            return true;
        }
    }

    constructor(url, username) {
        super(url);

        this.binaryType = "arraybuffer";
        this.username = username;

        this.addEventListener("open", this.onOpen.bind(this));
        this.addEventListener("close", this.onClose.bind(this));
        this.addEventListener("message", this.onMessage.bind(this));

        this.lobbyID = "";

        if (localStorage.token?.length > 4) {
            this.devCheatListener = new ClientSocket.Listener(this);

            window.floof_dev = {
                spawnMob:  (index, rarity) => {
                    if (typeof index === "string") {
                        index = state.mobConfigs.findIndex(m => m.name === index);

                        if (index === -1) {
                            return new Promise(resolve => resolve({
                                ok: false,
                                message: "Invalid mob name"
                            }));
                        }
                    }

                    if (typeof rarity === "string") {
                        rarity = state.tiers.findIndex(t => t.name === rarity);

                        if (rarity === -1) {
                            return new Promise(resolve => resolve({
                                ok: false,
                                message: "Invalid rarity name"
                            }));
                        }
                    }

                    return this.devCheatListener.wait({ id: DEV_CHEAT_IDS.SPAWN_MOB, index, rarity });
                },
                setPetal: (clientID, slotID, index, rarity) => {
                    if (typeof index === "string") {
                        index = state.petalConfigs.findIndex(p => p.name === index);

                        if (index === -1) {
                            return new Promise(resolve => resolve({
                                ok: false,
                                message: "Invalid petal name"
                            }));
                        }
                    }

                    if (typeof rarity === "string") {
                        rarity = state.tiers.findIndex(t => t.name === rarity);

                        if (rarity === -1) {
                            return new Promise(resolve => resolve({
                                ok: false,
                                message: "Invalid rarity name"
                            }));
                        }
                    }

                    console.log(clientID, slotID, index, rarity);

                    return this.devCheatListener.wait({ id: DEV_CHEAT_IDS.SET_PETAL, clientID, slotID, index, rarity });
                },
                setXP: (clientID, xp) => this.devCheatListener.wait({ id: DEV_CHEAT_IDS.SET_XP, clientID, xp }),
                infoDump: () => this.devCheatListener.wait({ id: DEV_CHEAT_IDS.INFO_DUMP }),
            };
        }

        this._dataIn = 0;
        this._dataOut = 0;

        this.bandWidth = {
            in: 0,
            out: 0
        };

        this.bandwidthTracker = setInterval(() => {
            this.bandWidth.in = (this._dataIn / 1024).toFixed(2);
            this.bandWidth.out = (this._dataOut / 1024).toFixed(2);
            this._dataIn = 0;
            this._dataOut = 0;
        }, 1E3);
    }

    onOpen() {
        console.log("Connected to lobby");
        this.verify(this.username);
        setTimeout(() => this.ping(), 1E3);
    }

    onClose() {
        console.log("Disconnected from lobby");
        state.disconnected = true;
    }

    onMessage(event) {
        const reader = new Reader(new DataView(new Uint8Array(event.data).buffer), 0, true);
        this._dataIn += event.data.byteLength;

        switch (reader.getUint8()) {
            case CLIENT_BOUND.KICK:
                state.disconnectMessage = "Kicked: " + reader.getStringUTF8();
                break;
            case CLIENT_BOUND.READY:
                console.log("Ready");
                this.spawn();
                break;
            case CLIENT_BOUND.WORLD_UPDATE:
                state.updatesCounter++;
                state.camera.realX = reader.getFloat32();
                state.camera.realY = reader.getFloat32();
                state.camera.realFov = reader.getFloat32();
                state.camera.lightingBoost = reader.getUint8();
                state.playerID = reader.getUint32();

                let id;
                while (id = reader.getUint32(), id > 0) {
                    const flags = reader.getUint8();
                    let player = state.players.get(id);

                    if (!player) {
                        player = new ClientPlayer(id);
                        state.players.set(id, player);
                    }

                    if (flags === ENTITY_FLAGS.NEW) {
                        player.name = reader.getStringUTF8();
                        player.nameColor = reader.getStringUTF8();
                        player.rarity = reader.getUint8();
                        player.level = reader.getUint16();
                        player.realX = reader.getFloat32();
                        player.realY = reader.getFloat32();
                        player.realSize = reader.getFloat32();
                        player.realFacing = reader.getFloat32();

                        const eflags = reader.getUint8();
                        player.hit = eflags & ENTITY_MODIFIER_FLAGS.HIT;
                        player.attack = (eflags & ENTITY_MODIFIER_FLAGS.ATTACK) === ENTITY_MODIFIER_FLAGS.ATTACK;
                        player.defend = (eflags & ENTITY_MODIFIER_FLAGS.DEFEND) === ENTITY_MODIFIER_FLAGS.DEFEND;
                        player.poisoned = (eflags & ENTITY_MODIFIER_FLAGS.POISON) === ENTITY_MODIFIER_FLAGS.POISON;

                        if (eflags & ENTITY_MODIFIER_FLAGS.TDM) {
                            player.team = reader.getUint8();
                        }

                        if (eflags & ENTITY_MODIFIER_FLAGS.WEARABLES) {
                            player.wearing = reader.getUint8();
                        }

                        player.realHealthRatio = reader.getUint8() / 255;
                        player.healthRatio = player.realHealthRatio;

                        player.realShieldRatio = reader.getUint8() / 255;
                        player.shieldRatio = player.realShieldRatio;

                        player.x = player.realX;
                        player.y = player.realY;
                        player.size = player.realSize;
                        player.facing = player.realFacing;
                        continue;
                    }

                    if (flags === ENTITY_FLAGS.DIE) {
                        state.players.delete(id);
                        continue;
                    }

                    if (flags & ENTITY_FLAGS.POSITION) {
                        player.realX = reader.getFloat32();
                        player.realY = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.SIZE) {
                        player.realSize = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.FACING) {
                        player.realFacing = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.FLAGS) {
                        const eflags = reader.getUint8();
                        player.hit = eflags & ENTITY_MODIFIER_FLAGS.HIT;
                        player.attack = (eflags & ENTITY_MODIFIER_FLAGS.ATTACK) === ENTITY_MODIFIER_FLAGS.ATTACK;
                        player.defend = (eflags & ENTITY_MODIFIER_FLAGS.DEFEND) === ENTITY_MODIFIER_FLAGS.DEFEND;
                        player.poisoned = (eflags & ENTITY_MODIFIER_FLAGS.POISON) === ENTITY_MODIFIER_FLAGS.POISON;

                        if (eflags & ENTITY_MODIFIER_FLAGS.TDM) {
                            player.team = reader.getUint8();
                        }

                        if (eflags & ENTITY_MODIFIER_FLAGS.WEARABLES) {
                            player.wearing = reader.getUint8();
                        }
                    }

                    if (flags & ENTITY_FLAGS.HEALTH) {
                        player.realHealthRatio = reader.getUint8() / 255;
                        player.realShieldRatio = reader.getUint8() / 255;
                    }

                    if (flags & ENTITY_FLAGS.DISPLAY) {
                        player.name = reader.getStringUTF8();
                        player.nameColor = reader.getStringUTF8();
                        player.rarity = reader.getUint8();
                        player.level = reader.getUint16();
                    }
                }

                while (id = reader.getUint32(), id > 0) {
                    const flags = reader.getUint8();
                    let petal = state.petals.get(id);

                    if (!petal) {
                        petal = new ClientPetal(id);
                        state.petals.set(id, petal);
                    }

                    if (flags === ENTITY_FLAGS.NEW) {
                        petal.index = reader.getUint8();
                        petal.realX = reader.getFloat32();
                        petal.realY = reader.getFloat32();
                        petal.realSize = reader.getFloat32();
                        petal.realFacing = reader.getFloat32();

                        const eFlags = reader.getUint8();
                        petal.hit = eFlags & ENTITY_MODIFIER_FLAGS.HIT;

                        petal.x = petal.realX;
                        petal.y = petal.realY;
                        petal.size = petal.realSize;
                        petal.facing = petal.realFacing;
                        continue;
                    }

                    if (flags === ENTITY_FLAGS.DIE) {
                        state.petals.delete(id);
                        continue;
                    }

                    if (flags & ENTITY_FLAGS.POSITION) {
                        petal.realX = reader.getFloat32();
                        petal.realY = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.SIZE) {
                        petal.realSize = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.FACING) {
                        petal.realFacing = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.FLAGS) {
                        const eFlags = reader.getUint8();
                        petal.hit = eFlags & ENTITY_MODIFIER_FLAGS.HIT;
                    }
                }

                while (id = reader.getUint32(), id > 0) {
                    const flags = reader.getUint8();
                    let mob = state.mobs.get(id);

                    if (!mob) {
                        mob = new ClientMob(id);
                        state.mobs.set(id, mob);
                    }

                    if (flags === ENTITY_FLAGS.NEW) {
                        mob.index = reader.getUint8();
                        mob.rarity = reader.getUint8();
                        mob.realX = reader.getFloat32();
                        mob.realY = reader.getFloat32();
                        mob.realSize = reader.getFloat32();
                        mob.realFacing = reader.getFloat32();

                        const eFlags = reader.getUint8();
                        mob.hit = (eFlags & ENTITY_MODIFIER_FLAGS.HIT) === ENTITY_MODIFIER_FLAGS.HIT;
                        mob.attack = (eFlags & ENTITY_MODIFIER_FLAGS.ATTACK) === ENTITY_MODIFIER_FLAGS.ATTACK;
                        mob.poisoned = (eFlags & ENTITY_MODIFIER_FLAGS.POISON) === ENTITY_MODIFIER_FLAGS.POISON;
                        mob.friendly = (eFlags & ENTITY_MODIFIER_FLAGS.FRIEND) === ENTITY_MODIFIER_FLAGS.FRIEND;

                        mob.realHealthRatio = reader.getUint8() / 255;
                        mob.healthRatio = mob.realHealthRatio;

                        mob.x = mob.realX;
                        mob.y = mob.realY;
                        mob.size = mob.realSize;
                        mob.facing = mob.realFacing;

                        switch (state.mobConfigs[mob.index].name) {
                            case "Starfish":
                                mob.extraData = new StarfishData();
                                break;
                            case "Leech":
                                mob.extraData = [{
                                    x: 0,
                                    y: 0,
                                    realX: 0,
                                    realY: 0
                                }];
                                break;
                        }
                        continue;
                    }

                    if (flags === ENTITY_FLAGS.DIE) {
                        state.mobs.delete(id);
                        continue;
                    }

                    if (flags & ENTITY_FLAGS.POSITION) {
                        mob.realX = reader.getFloat32();
                        mob.realY = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.SIZE) {
                        mob.realSize = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.FACING) {
                        mob.realFacing = reader.getFloat32();
                    }

                    if (flags & ENTITY_FLAGS.FLAGS) {
                        const eFlags = reader.getUint8();
                        mob.hit = eFlags & ENTITY_MODIFIER_FLAGS.HIT;
                        mob.attack = (eFlags & ENTITY_MODIFIER_FLAGS.ATTACK) === ENTITY_MODIFIER_FLAGS.ATTACK;
                        mob.poisoned = (eFlags & ENTITY_MODIFIER_FLAGS.POISON) === ENTITY_MODIFIER_FLAGS.POISON;
                        mob.friendly = (eFlags & ENTITY_MODIFIER_FLAGS.FRIEND) === ENTITY_MODIFIER_FLAGS.FRIEND;
                    }

                    if (flags & ENTITY_FLAGS.HEALTH) {
                        mob.realHealthRatio = reader.getUint8() / 255;
                    }

                    if (flags & ENTITY_FLAGS.ROPE_BODIES) {
                        const count = reader.getUint8();

                        if (count !== mob.extraData.length) {
                            mob.extraData = [];

                            for (let i = 0; i < count; i++) {
                                mob.extraData.push({
                                    x: reader.getFloat32(),
                                    y: reader.getFloat32()
                                });

                                mob.extraData[i].realX = mob.extraData[i].x;
                                mob.extraData[i].realY = mob.extraData[i].y;
                            }
                        } else {
                            for (let i = 0; i < count; i++) {
                                mob.extraData[i].realX = reader.getFloat32();
                                mob.extraData[i].realY = reader.getFloat32();
                            }
                        }
                    }
                }

                while (id = reader.getUint32(), id > 0) {
                    state.drops.set(id, {
                        id: id,
                        x: reader.getFloat32(),
                        y: reader.getFloat32(),
                        size: reader.getFloat32(),
                        index: reader.getUint8(),
                        rarity: reader.getUint8()
                    });
                }

                while (id = reader.getUint32(), id > 0) {
                    state.drops.delete(id);
                }

                while (id = reader.getUint32(), id > 0) {
                    const flags = reader.getUint8();
                    let marker = state.markers.get(id);

                    if (!marker) {
                        marker = new ClientMarker(id);
                        state.markers.set(id, marker);
                    }

                    if (flags === ENTITY_FLAGS.NEW) {
                        marker.x = reader.getFloat32();
                        marker.y = reader.getFloat32();
                        marker.size = reader.getFloat32();
                        marker.creation = +reader.getStringUTF8();
                        marker.timer = reader.getUint32();
                        continue;
                    }

                    if (flags === ENTITY_FLAGS.DIE) {
                        state.markers.delete(id);
                        continue;
                    }
                }

                while (id = reader.getUint32(), id > 0) {
                    const lightning = new ClientLightning(id);
                    const count = reader.getUint16();

                    for (let i = 0; i < count; i++) {
                        lightning.points.push({
                            x: reader.getFloat32(),
                            y: reader.getFloat32()
                        });
                    }

                    lightning.improvePoints();

                    state.lightning.set(id, lightning);
                }

                { // Main slots
                    const count = reader.getUint8();

                    if (count !== state.slots.length) {
                        state.slots = [];
                    }

                    for (let i = 0; i < count; i++) {
                        state.slots[i] ??= { ratio: 1 };
                        state.slots[i].index = reader.getUint8();
                        state.slots[i].rarity = reader.getUint8();
                        state.slots[i].realRatio = reader.getFloat32();
                    }
                } { // Secondary slots
                    const count = reader.getUint8();

                    if (count !== state.secondarySlots.length) {
                        state.secondarySlots = [];
                    }

                    for (let i = 0; i < count; i++) {
                        const isNotNull = reader.getUint8() === 1;

                        if (isNotNull) {
                            state.secondarySlots[i] ??= {};
                            state.secondarySlots[i].index = reader.getUint8();
                            state.secondarySlots[i].rarity = reader.getUint8();
                        } else {
                            state.secondarySlots[i] ??= {};
                            state.secondarySlots[i].index = -1;
                        }
                    }
                }

                if (reader.getUint8() === 1) {
                    state.waveInfo = {
                        wave: reader.getUint16(),
                        livingMobs: reader.getUint16(),
                        maxMobs: reader.getUint16()
                    };
                } else {
                    state.waveInfo = null
                }

                state.level = reader.getUint16();
                state.levelProgressTarget = reader.getFloat32();
                break;
            case CLIENT_BOUND.ROOM_UPDATE:
                state.room.width = reader.getFloat32();
                state.room.height = reader.getFloat32();
                state.room.isRadial = reader.getUint8() === 1;
                state.room.biome = reader.getUint8();
                break;
            case CLIENT_BOUND.DEATH:
                state.isDead = true;
                state.killMessage = reader.getStringUTF8();
                break;
            case CLIENT_BOUND.UPDATE_ASSETS:
                console.warn("Server is asking us to update assets");
                loadAssets(this.lobbyID);
                break;
            case CLIENT_BOUND.JSON_MESSAGE:
                if (this.devCheatListener) {
                    const data = JSON.parse(reader.getStringUTF8());
                    if (!this.devCheatListener.handle(data.promiseID, (() => {
                        delete data.promiseID;
                        return data;
                    })())) {
                        console.warn("Unhandled JSON message", data);
                    }
                } else {
                    console.warn("Received JSON message without a listener:", reader.getStringUTF8());
                }
                break;
            case CLIENT_BOUND.PONG:
                state.ping = performance.now() - this.pingStart;
                setTimeout(() => this.ping(), 1E3);
                break;
            case CLIENT_BOUND.TERRAIN:
                state.terrain = {
                    width: reader.getUint16(),
                    height: reader.getUint16(),
                    blocks: ((blocks = []) => {
                        for (let i = reader.getUint16(); i > 0; i--) {
                            blocks.push({
                                x: reader.getInt16(),
                                y: reader.getInt16(),
                                type: [reader.getUint8(), reader.getUint8()],
                                terrain: []
                            });

                            blocks[blocks.length - 1].terrain = terrains[blocks[blocks.length - 1].type[0]][blocks[blocks.length - 1].type[1]];
                        }

                        return blocks;
                    })(),
                    overlay: null
                };

                state.terrainImg = renderTerrain(state.room.width * .5, state.room.height * .5, state.terrain.width, state.terrain.blocks, state.room.biome);
                state.minimapImg = renderTerrainForMap(state.terrain.width, state.terrain.blocks);
                console.log(state.terrain.blocks);
                if (util.isHalloween && state.terrain.blocks.length >= 8) {
                    state.terrain.overlay = new SpookyOverlay(state.terrain.blocks, state.terrain.width, state.terrain.height);
                } else {
                    state.terrain.overlay = null;
                }
                break;
            case CLIENT_BOUND.CHAT_MESSAGE: {
                const type = reader.getUint8();

                switch (type) {
                    case 0: // Chat Message
                        new ChatMessage(0, reader.getStringUTF8(), reader.getStringUTF8(), reader.getStringUTF8());
                        break;
                    case 1: // System Message
                        new ChatMessage(1, reader.getStringUTF8(), reader.getStringUTF8());
                        break;
                }
            } break;
        }
    }

    ping() {
        this.pingStart = performance.now();
        this.talk(SERVER_BOUND.PING);
    }

    verify(username) {
        this.talk(SERVER_BOUND.VERIFY, username);
    }

    spawn() {
        this.talk(SERVER_BOUND.SPAWN);
    }

    talk(type, data) {
        if (this.readyState !== WebSocket.OPEN) {
            return;
        }

        const writer = new Writer(true);
        writer.setUint8(type);

        switch (type) {
            case SERVER_BOUND.VERIFY:
                writer.setStringUTF8(data);
                break;
            case SERVER_BOUND.SPAWN: // nada atm
                break;
            case SERVER_BOUND.INPUTS:
                writer.setUint8(data);

                if (util.options.mouseMovement) {
                    const x = mouse.x - canvas.width / 2;
                    const y = mouse.y - canvas.height / 2;
                    const angle = Math.atan2(y, x);
                    const dist = util.quickDiff({ x: 0, y: 0, }, { x, y });

                    writer.setFloat32(angle);
                    writer.setFloat32(dist / canvas.width / 2);
                }
                break;
            case SERVER_BOUND.CHANGE_LOADOUT: {
                const { drag, drop } = data; // { type, index }
                writer.setUint8(drag.type);
                writer.setUint8(drag.index);
                writer.setUint8(drop.type);
                writer.setUint8(drop.index);
            } break;
            case SERVER_BOUND.DEV_CHEAT: {
                const type = Number.isInteger(data) ? data : data.id;
                writer.setUint8(type);

                switch (type) {
                    case DEV_CHEAT_IDS.TELEPORT:
                        const tpUScale = gameScale(state.camera.fov);
                        writer.setFloat32((mouse.x - canvas.width / 2) / tpUScale);
                        writer.setFloat32((mouse.y - canvas.height / 2) / tpUScale);
                        break;
                    case DEV_CHEAT_IDS.CHANGE_TEAM:
                        let id = 0,
                            sc = gameScale(state.camera.fov),
                            x = state.camera.x + (mouse.x - canvas.width / 2) / sc,
                            y = state.camera.y + (mouse.y - canvas.height / 2) / sc;

                        for (const mob of state.mobs.values()) {
                            let dx = mob.x - x,
                                dy = mob.y - y,
                                dist = Math.sqrt(dx * dx + dy * dy);

                            if (dist < mob.size) {
                                id = mob.id;
                                break;
                            }
                        }

                        for (const player of state.players.values()) {
                            let dx = player.x - x,
                                dy = player.y - y,
                                dist = Math.sqrt(dx * dx + dy * dy);

                            if (dist < player.size) {
                                id = player.id;
                                break;
                            }
                        }

                        writer.setUint32(id);
                        break;
                    case DEV_CHEAT_IDS.SPAWN_MOB:
                        writer.setUint32(data.promiseID);
                        writer.setUint8(data.index);
                        writer.setUint8(data.rarity);
                        break;
                    case DEV_CHEAT_IDS.SET_PETAL:
                        writer.setUint32(data.promiseID);
                        writer.setUint32(data.clientID);
                        writer.setUint8(data.slotID);
                        writer.setUint8(data.index);
                        writer.setUint8(data.rarity);
                        break;
                    case DEV_CHEAT_IDS.SET_XP:
                        writer.setUint32(data.promiseID);
                        writer.setUint32(data.clientID);
                        writer.setUint32(data.xp);
                        break;
                    case DEV_CHEAT_IDS.INFO_DUMP:
                        writer.setUint32(data.promiseID);
                        break;
                }
            } break;
            case SERVER_BOUND.CHAT_MESSAGE:
                writer.setStringUTF8(data);
                break;
        }

        const output = writer.build();
        this._dataOut += output.byteLength;

        this.send(output);
    }
}

export class IconItem {
    x = 0;
    y = 0;
    size = 0;

    realX = 0;
    realY = 0;
    realSize = 0;

    interpolate() {
        this.x = util.lerp(this.x, this.realX, .2);
        this.y = util.lerp(this.y, this.realY, .2);
        this.size = util.lerp(this.size, this.realSize, .2);
    }
}

export const state = {
    interpolationFactor: .2,
    username: "",

    camera: {
        x: 0,
        y: 0,
        fov: 512,
        lightingBoost: 0,

        realX: 0,
        realY: 0,
        realFov: 1025 + 256,

        interpolate: () => {
            state.camera.x = util.lerp(state.camera.x, state.camera.realX, state.interpolationFactor);
            state.camera.y = util.lerp(state.camera.y, state.camera.realY, state.interpolationFactor);
            state.camera.fov = util.lerp(state.camera.fov, state.camera.realFov, state.interpolationFactor);
        }
    },

    room: {
        width: 100,
        height: 100,
        isRadial: false,
        biome: (() => {
            switch (localStorage.biome) {
                case "default":
                    return BIOME_TYPES.DEFAULT;
                case "garden":
                    return BIOME_TYPES.GARDEN;
                case "desert":
                    return BIOME_TYPES.DESERT;
                case "ocean":
                    return BIOME_TYPES.OCEAN;
                case "antHell":
                    return BIOME_TYPES.ANT_HELL;
                case "sewers":
                    return BIOME_TYPES.SEWERS;
                case "hell":
                    return BIOME_TYPES.HELL;
                case "halloween":
                    if (util.isHalloween) {
                        return BIOME_TYPES.HALLOWEEN;
                    } else {
                        return BIOME_TYPES.DEFAULT;
                    }
                case "dark_forest":
                    return BIOME_TYPES.DARK_FOREST
                default:
                    return BIOME_TYPES.DEFAULT;
            }
        })()
    },

    playerID: 0,

    /** @type {Map<number, ClientPlayer>} */
    players: new Map(),

    /** @type {Map<number, ClientPetal>} */
    petals: new Map(),

    /** @type {Map<number, ClientMob>} */
    mobs: new Map(),

    /** @type {Map<number, {id:number,x:number,y:number,size:number,index:number,rarity:number}>} */
    drops: new Map(),

    /** @type {Map<number, ClientMarker>} */
    markers: new Map(),

    /** @type {Map<number, ClientLightning>} */
    lightning: new Map(),

    /** @type {ClientSocket|null} */
    socket: null,

    /** @type {{name:string,color:string}[]} */
    tiers: [],

    petalConfigs: [],
    mobConfigs: [],

    disconnected: false,
    disconnectMessage: "Connection lost",
    isDead: false,
    killMessage: "",

    /** @type {{index:number,rarity:number,icon:IconItem}[]} */
    slots: [],

    /** @type {{index:number,rarity:number,icon:IconItem}[]} */
    secondarySlots: [],

    destroyIcon: new IconItem(),

    petalHover: null,

    /** @type {{wave:number,livingMobs:number,maxMobs:number}|null} */
    waveInfo: null,

    level: 1,
    levelProgress: 0,
    levelProgressTarget: 0,

    isInDestroy: false,

    updatesCounter: 0,
    updateRate: 0,
    ping: 0,
    lastPingTime: 0,

    /** @type {{width:number,height:number,blocks:{x:number,y:number,type:number}[],overlay:SpookyOverlay}|null} */
    terrain: null,
    /** @type {OffscreenCanvas|null} */
    terrainImg: null,
    /** @type {OffscreenCanvas|null} */
    minimapImg: null
};

export const keyMap = new Set();
export const mouse = {
    x: 0,
    y: 0,
    left: false,
    right: false
};

export async function loadAssets(lobbyID) {
    const response = await fetch(`${util.SERVER_URL}/lobby/resources?partyURL=${lobbyID}`);
    const text = await response.text();

    if (text === "null") {
        return false;
    }

    const decoded = decodeEverything(JSON.parse(text));

    location.hash = lobbyID;
    state.tiers = decoded.tiers;
    state.petalConfigs = decoded.petalConfigs;
    state.mobConfigs = decoded.mobConfigs;

    await loadTerrains();

    return true;
}

let clientSocketDone = false;
export async function beginState(lobbyID, username, serverURL = util.SERVER_URL.replace("http", "ws")) {
    if (clientSocketDone) {
        return;
    }

    clientSocketDone = true;

    state.username = username;

    // Load resources
    try {
        if (!(await loadAssets(lobbyID))) {
            alert("Failed to load assets");
            clientSocketDone = false;
            return;
        }

        location.hash = lobbyID;
        state.socket = new ClientSocket(`${serverURL}/ws/client?partyURL=${lobbyID}&clientKey=${localStorage.getItem("token") ?? ""}&uuid=${UUID}&analytics=${analyticalData}`, username);
        state.socket.lobbyID = lobbyID;
    } catch (error) {
        console.error(error);
        alert("Couldn't connect");
        clientSocketDone = false;
    }
}