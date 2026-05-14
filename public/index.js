import { canvas, ctx, drawBackground, drawBackgroundOverlay, drawBar, drawFace, drawWrappedText, gameScale, mixColors, setStyle, text, uiScale } from "./lib/canvas.js";
import * as net from "./lib/net.js";
import { mouse, keyMap } from "./lib/net.js";
import { colors, isHalloween, lerp, options, SERVER_URL, shakeElement } from "./lib/util.js";
import { BIOME_BACKGROUNDS, BIOME_TYPES, DEV_CHEAT_IDS, SERVER_BOUND, terrains, WEARABLES } from "./lib/protocol.js";
import { drawMob, drawPetal, getPetalIcon, drawUIPetal, petalTooltip, drawThirdEye, drawAntennae, pentagram, drawAmulet, drawPetalIconWithRatio, drawArmor } from "./lib/renders.js";
import { beginDragDrop, DRAG_TYPE_DESTROY, DRAG_TYPE_MAINDOCKER, DRAG_TYPE_SECONDARYDOCKER, dragConfig, updateAndDrawDragDrop } from "./lib/dragAndDrop.js";
import { loadAndRenderChangelogs, showMenu, showMenus } from "./lib/menus.js";
import "./lib/floofMod.js";

if (location.hash) {
    fetch(SERVER_URL + "/lobby/get?partyURL=" + location.hash.slice(1)).then(response => response.json()).then(json => {
        if (json == null) {
            console.warn("Invalid party URL");
            location.hash = "";
            history.replaceState(null, null, location.pathname + location.search);
        } else {
            getUsername().then(async u => {
                const res = await fetch(SERVER_URL + "/lobby/get?partyURL=" + location.hash.slice(1));
                const text = await res.text();

                if (text == "null") {
                    alert("Invalid party URL");
                    location.hash = "";
                    history.replaceState(null, null, location.pathname + location.search);
                    return;
                }

                const lobby = JSON.parse(text);

                net.beginState(location.hash.slice(1), u, lobby.directConnect ? location.protocol.replace("http", "ws") + "//" + lobby.directConnect.address : SERVER_URL.replace("http", "ws"));
            });
        }
    }).catch(() => {
        console.warn("Invalid party URL");
        location.hash = "";
        history.replaceState(null, null, location.pathname + location.search);
    });
}

document.getElementById("lobbyName").value = "Lobby " + Math.floor(Math.random() * 1000);

function refreshLobbies() {
    const lobbiesDisplay = document.getElementById("lobbiesDisplay");
    lobbiesDisplay.innerHTML = "<span>Loading...</span>";
    net.findLobbies().then(lobbies => {
        lobbiesDisplay.innerHTML = "";
        lobbies.forEach(lobby => {
            const element = document.createElement("div");
            element.textContent = lobby.name + " (" + BIOME_BACKGROUNDS[lobby.biome].name + " " + lobby.gamemode + ")";

            if (lobby.isModded) {
                element.textContent += " (modded)";
            }

            if (lobby.trusted) {
                element.style.color = colors.playerYellow;
                element.textContent += " (trusted)";
            }

            element.onclick = () => {
                getUsername().then(username => {
                    net.beginState(lobby.partyCode, username, lobby.directConnect ? location.protocol.replace("http", "ws") + "//" + lobby.directConnect.address : SERVER_URL.replace("http", "ws"));
                });
            };

            lobbiesDisplay.appendChild(element);
        });
    });
}

document.getElementById("refreshLobbies").onclick = refreshLobbies;

function changeMenu(activeMenuID) {
    document.querySelectorAll(".preMenu").forEach(menu => {
        menu.classList.remove("active");

        if (menu.id === activeMenuID) {
            menu.classList.add("active");

            if (activeMenuID === "findLobbies") {
                refreshLobbies();
            }
        }
    });
}

document.querySelectorAll("button").forEach(button => {
    if (button.dataset.switchmenu) {
        button.onclick = () => changeMenu(button.dataset.switchmenu);
    }
});

async function getUsername() {
    changeMenu("usernameInput");

    return new Promise(resolve => {
        const usernameInputInput = document.getElementById("usernameInputInput");
        const button = document.getElementById("usernameButton");

        button.onclick = () => {
            const value = usernameInputInput.value.trim() || "guest";

            if (value.length > 24) {
                shakeElement(usernameInputInput);
                return;
            }

            button.onclick = null;
            changeMenu("thisshouldntexistsoletshopeitdoesnt");
            resolve(value);
        };
    });
}

let hasCreatedLobby = false;
document.getElementById("createLobbyButton").onclick = async () => {
    if (hasCreatedLobby) {
        return;
    }

    const lobbyName = document.getElementById("lobbyName");

    if (lobbyName.value.length < 3 || lobbyName.value.length > 16 || !/^[a-zA-Z0-9 ]+$/.test(lobbyName.value)) {
        shakeElement(lobbyName);
        return;
    }

    const gamemodeSelect = document.getElementById("gamemodeSelect");
    localStorage.setItem("gamemode", gamemodeSelect.value);

    const biomeSelect = document.getElementById("biomeSelect");
    localStorage.setItem("biome", biomeSelect.value);

    const enableMods = document.getElementById("enableMods");
    localStorage.setItem("enableMods", enableMods.checked);

    const privateLobby = document.getElementById("privateLobby");
    localStorage.setItem("privateLobby", privateLobby.checked);

    hasCreatedLobby = true;

    document.getElementById("createLobbyButton").disabled = true;
    const server = await net.createServer(lobbyName.value, gamemodeSelect.value, enableMods.checked, privateLobby.checked, biomeSelect.value);
    document.getElementById("createLobbyButton").disabled = false;

    if (!server.ok) {
        alert(server.error);
        hasCreatedLobby = false;
        return;
    }

    const username = await getUsername();
    localStorage.setItem("username", username);

    net.beginState(server.party, username);
}

let lastFlag = 0,
    mouseX = 0,
    mouseY = 0;

function processInputs() {
    let newFlags = 0;

    if (keyMap.has("w") || keyMap.has("arrowup")) {
        newFlags |= 0x01;
    }

    if (keyMap.has("a") || keyMap.has("arrowleft")) {
        newFlags |= 0x02;
    }

    if (keyMap.has("s") || keyMap.has("arrowdown")) {
        newFlags |= 0x04;
    }

    if (keyMap.has("d") || keyMap.has("arrowright")) {
        newFlags |= 0x08;
    }

    if (keyMap.has(" ") || mouse.left) {
        newFlags |= 0x10;
    }

    if (keyMap.has("shift") || mouse.right) {
        newFlags |= 0x20;
    }

    if (newFlags !== lastFlag || mouseX !== mouse.x || mouseY !== mouse.y) {
        if (options.mouseMovement) {
            newFlags |= 0x40;
            mouseX = mouse.x;
            mouseY = mouse.y;
        }

        net.state.socket?.talk(SERVER_BOUND.INPUTS, newFlags);
        lastFlag = newFlags;
    }
}

window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        net.ChatMessage.showInput = !net.ChatMessage.showInput;

        setTimeout(() => {
            if (net.ChatMessage.showInput) {
                net.ChatMessage.element.focus();
            }
        }, 250);
    }

    if (net.ChatMessage.showInput && net.ChatMessage.element === document.activeElement) {
        if (e.key === "Enter") {
            net.ChatMessage.send();
        }

        return;
    }

    if (e.keyCode === 13 && net.state.isDead && net.state.socket?.readyState === WebSocket.OPEN) {
        net.state.socket.spawn();
        net.state.isDead = false;
        return;
    }
    if (net.state.socket?.readyState === WebSocket.OPEN) {
        switch (e.key.toLowerCase()) {
            case ";":
                net.state.socket.talk(SERVER_BOUND.DEV_CHEAT, DEV_CHEAT_IDS.GODMODE);
                break;
            case "t":
                net.state.socket.talk(SERVER_BOUND.DEV_CHEAT, DEV_CHEAT_IDS.TELEPORT);
                break;
            case "z":
                net.state.socket.talk(SERVER_BOUND.DEV_CHEAT, DEV_CHEAT_IDS.CHANGE_TEAM);
                break;
            case "x":
                if (net.state.socket?.readyState === WebSocket.OPEN) {
                    for (let i = 0; i < net.state.slots.length; i++) {
                        if (net.state.slots[i].index > -1 && net.state.secondarySlots[i]?.index > -1) {
                            net.state.socket.talk(SERVER_BOUND.CHANGE_LOADOUT, {
                                drag: {
                                    type: net.state.isInDestroy ? DRAG_TYPE_SECONDARYDOCKER : DRAG_TYPE_MAINDOCKER,
                                    index: i
                                },
                                drop: {
                                    type: net.state.isInDestroy ? DRAG_TYPE_DESTROY : DRAG_TYPE_SECONDARYDOCKER,
                                    index: i
                                }
                            });
                        }
                    }
                }
                break;
            case "k":
                net.state.isInDestroy = true;
                break;
        }

        if (e.key >= "0" && e.key <= "9") {
            const index = e.key === "0" ? 9 : parseInt(e.key) - 1;

            if (net.state.socket?.readyState === WebSocket.OPEN && index < net.state.slots.length && net.state.slots[index].index > -1 && net.state.secondarySlots[index]?.index > -1) {
                net.state.socket.talk(SERVER_BOUND.CHANGE_LOADOUT, {
                    drag: {
                        type: net.state.isInDestroy ? DRAG_TYPE_SECONDARYDOCKER : DRAG_TYPE_MAINDOCKER,
                        index
                    },
                    drop: {
                        type: net.state.isInDestroy ? DRAG_TYPE_DESTROY : DRAG_TYPE_SECONDARYDOCKER,
                        index
                    }
                });
            }
        }

        keyMap.add(e.key.toLowerCase());

        processInputs();
    }
});

window.addEventListener("keyup", e => {
    keyMap.delete(e.key.toLowerCase());

    if (e.key === "k") {
        net.state.isInDestroy = false;
    }

    if (net.state.socket?.readyState === WebSocket.OPEN) {
        processInputs();
    }
});

window.addEventListener("mousemove", e => {
    mouse.x = e.clientX * window.devicePixelRatio;
    mouse.y = e.clientY * window.devicePixelRatio;

    if (options.mouseMovement) {
        processInputs();
    }
});

window.addEventListener("mousedown", e => {
    switch (e.button) {
        case 0:
            mouse.left = true;
            break;
        case 2:
            mouse.right = true;
            break;
    }

    if (net.state.socket?.readyState === WebSocket.OPEN) {
        processInputs();
    }
});

window.addEventListener("mouseup", e => {
    switch (e.button) {
        case 0:
            mouse.left = false;
            break;
        case 2:
            mouse.right = false;
            break;
    }

    if (net.state.socket?.readyState === WebSocket.OPEN) {
        processInputs();
    }
});

function processDrop() {
    const drag = {
        type: dragConfig.type,
        index: dragConfig.index
    };

    let drop = null;

    const mX = mouse.x / uiScale();
    const mY = mouse.y / uiScale();

    for (let i = 0; i < net.state.slots.length; i++) {
        const slot = net.state.slots[i];

        if (slot.icon && slot.icon.x < mX && slot.icon.x + slot.icon.size > mX && slot.icon.y < mY && slot.icon.y + slot.icon.size > mY) {
            drop = {
                type: DRAG_TYPE_MAINDOCKER,
                index: i
            };
            break;
        }
    }

    if (drop === null) {
        for (let i = 0; i < net.state.secondarySlots.length; i++) {
            const slot = net.state.secondarySlots[i];

            if (slot.icon && slot.icon.x < mX && slot.icon.x + slot.icon.size > mX && slot.icon.y < mY && slot.icon.y + slot.icon.size > mY) {
                drop = {
                    type: DRAG_TYPE_SECONDARYDOCKER,
                    index: i
                };
                break;
            }
        }
    }

    if (drop === null) {
        const slot = net.state.destroyIcon;

        if (slot.realX < mX && slot.realX + slot.realSize > mX && slot.realY < mY && slot.realY + slot.realSize > mY) {
            drop = {
                type: DRAG_TYPE_DESTROY,
                index: 0
            };
        }
    }

    if (drop === null || (drop.type === drag.type && drop.index === drag.index)) {
        return false;
    }

    if (drag.type === DRAG_TYPE_MAINDOCKER && drop.type === DRAG_TYPE_SECONDARYDOCKER && net.state.secondarySlots[drop.index].index === -1) {
        return false;
    }

    if (drag.type === DRAG_TYPE_MAINDOCKER && drop.type === DRAG_TYPE_DESTROY) {
        return false;
    }

    net.state.socket.talk(SERVER_BOUND.CHANGE_LOADOUT, { drag, drop });

    return true;
}

const clientDebug = {
    fps: 0,
    mspt: 0,
    frames: 0,
    totalTime: 0
};

setInterval(() => {
    clientDebug.fps = clientDebug.frames;
    clientDebug.mspt = clientDebug.totalTime / Math.max(1, clientDebug.frames);
    clientDebug.frames = 0;
    clientDebug.totalTime = 0;

    net.state.updateRate = net.state.updatesCounter;
    net.state.updatesCounter = 0;
}, 1E3);

let cuteLittleAnimations = {
    nameText: 200,
    chatBGSize: 0
};

function draw() {
    net.state.interpolationFactor = options.rigidInterpolation ? .4 : .2;
    requestAnimationFrame(draw);

    const start = performance.now();

    if (net.state.socket?.readyState !== WebSocket.OPEN) {
        net.state.camera.realX += .5;
        net.state.camera.realY = Math.sin(net.state.camera.realX / 100) * 50;
    }

    net.state.camera.interpolate();

    const scale = gameScale(net.state.camera.fov);
    const cameraX = net.state.camera.x * scale;
    const cameraY = net.state.camera.y * scale;
    const halfWidth = canvas.width * .5;
    const halfHeight = canvas.height * .5;

    drawBackground(
        cameraX, cameraY, scale, net.state.socket?.readyState === WebSocket.OPEN,
        net.state.room.width, net.state.room.height,
        net.state.disconnected ? null : BIOME_BACKGROUNDS[net.state.room.biome],
        net.state.room.isRadial);

    if (net.state.disconnected) {
        const sc = uiScale();

        ctx.save();
        ctx.scale(sc, sc);
        const w = canvas.width / sc;
        const h = canvas.height / sc;
        text("Disconnected", w / 2, h / 2, 30);
        text(net.state.disconnectMessage, w / 2, h / 2 + 30, 15);
        ctx.restore();
        return;
    }

    if (net.state.terrain !== null && net.state.terrainImg) {
        ctx.drawImage(net.state.terrainImg, -net.state.room.width / 2 * scale - cameraX + halfWidth, -net.state.room.height / 2 * scale - cameraY + halfHeight, net.state.room.width * scale, net.state.room.height * scale);
    }

    net.state.markers.forEach(marker => {
        const drawX = marker.x * scale - cameraX + halfWidth;
        const drawY = marker.y * scale - cameraY + halfHeight;

        if (marker.tick > 1) {
            net.state.markers.delete(marker.id);
            return;
        }

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(marker.size * scale, marker.size * scale);
        pentagram(ctx, marker.tick);
        ctx.restore();
    });

    net.state.petals.forEach(entity => {
        entity.interpolate();

        let drawX = entity.x * scale - cameraX + halfWidth,
            drawY = entity.y * scale - cameraY + halfHeight;

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(entity.size * scale, entity.size * scale);
        ctx.rotate(entity.facing);
        drawPetal(entity.index, entity.hit, ctx, entity.id);
        ctx.restore();

        if (options.showHitboxes) {
            ctx.beginPath();
            ctx.arc(drawX, drawY, entity.size * scale, 0, Math.PI * 2);
            ctx.lineWidth = 1.5 * scale;
            ctx.strokeStyle = colors["???"];
            ctx.stroke();
        }
    });

    net.state.drops.forEach(entity => {
        let drawX = entity.x * scale - cameraX + halfWidth,
            drawY = entity.y * scale - cameraY + halfHeight,
            outlineTimer = (Math.sin(performance.now() / 250 + entity.id) + 1.5);
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(entity.size * scale, entity.size * scale);
        ctx.rotate(Math.sin(performance.now() / 1500 + entity.id * Math.PI / 6) * .5);

        ctx.fillStyle = colors.black;
        ctx.beginPath();
        ctx.roundRect(-.55 - .025 * outlineTimer, -.55 - .025 * outlineTimer, 1.1 + .05 * outlineTimer, 1.1 + .05 * outlineTimer, .1);
        ctx.globalAlpha *= .125;
        ctx.fill();
        ctx.closePath();

        ctx.globalAlpha /= .125;

        ctx.drawImage(getPetalIcon(entity.index, entity.rarity), -.5, -.5, 1, 1);

        ctx.restore();
    });

    net.state.mobs.forEach(entity => {
        entity.interpolate();

        let drawX = entity.x * scale - cameraX + halfWidth,
            drawY = entity.y * scale - cameraY + halfHeight;

        const size = entity.size * scale;

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.scale(size, size);
        ctx.rotate(entity.facing);

        if (options.fancyGraphics && net.state.room.biome === BIOME_TYPES.HELL) {
            ctx.shadowBlur = 10 * scale * (Math.sin(performance.now() / 500 + entity.id * 3) * .8 + .8);
            ctx.shadowColor = "#FFFFFF";
        }

        drawMob(entity.id, entity.index, entity.rarity, entity.hit, ctx, entity.attack, entity.friendly, entity.facing, entity.extraData);
        ctx.restore();

        if (options.showHitboxes) {
            ctx.beginPath();
            ctx.arc(drawX, drawY, size, 0, Math.PI * 2);
            ctx.lineWidth = 1.5 * scale;
            ctx.strokeStyle = colors["???"];
            ctx.stroke();
        }

        if (!options.hideEntityUI && !net.state.mobConfigs[entity.index].hideUI) {
            const barSize = Math.max(size, 30 * scale);
            const barthicc = (6 + entity.rarity) * scale;

            drawBar(drawX - barSize, drawX + barSize, drawY + barSize + 13 * scale, barthicc, colors["???"]);
            drawBar(drawX - barSize, drawX - barSize + barSize * 2 * entity.secondaryHealthBar, drawY + barSize + 13 * scale, .667 * barthicc, colors.legendary);
            drawBar(drawX - barSize, drawX - barSize + barSize * 2 * entity.healthRatio, drawY + barSize + 13 * scale, .667 * barthicc, entity.poisoned ? mixColors(colors.common, colors.irisPurple, .5 + Math.sin(performance.now() / 333 + entity.id * 3) * .5) : colors.common);

            ctx.textAlign = "left";
            text(net.state.mobConfigs[entity.index].name, drawX - barSize - barthicc * .5, drawY + barSize + 9 * scale - barthicc * .5, 8 * scale);

            ctx.textAlign = "right";
            text(net.state.tiers[entity.rarity].name, drawX + barSize + barthicc * .5, drawY + barSize + 19 * scale + barthicc * .5, 8 * scale, net.state.tiers[entity.rarity].color);
        }
    });

    ctx.textAlign = "center";

    net.state.players.forEach(entity => {
        entity.interpolate();

        let expression = 1,
            targetMouthDip = 1.7;

        if (entity.attack) {
            expression = 2;
            targetMouthDip = .35;
        }

        if (entity.defend) {
            expression = 3;
            targetMouthDip = .9;
        }

        entity.mood = lerp(entity.mood, expression, .15)
        entity.mouthDip = lerp(entity.mouthDip, targetMouthDip, .15);

        let drawX = entity.x * scale - cameraX + halfWidth,
            drawY = entity.y * scale - cameraY + halfHeight;

        if (entity.id === net.state.playerID) {
            drawX = halfWidth;
            drawY = halfHeight;
        }

        setStyle(mixColors([colors.playerYellow, colors.team1, colors.team2][entity.team] ?? colors.crafting, colors.legendary, entity.hit * .5), 5 * scale);

        const size = entity.size * scale;

        if (entity.wearing & WEARABLES.AMULET) {
            ctx.save();
            ctx.translate(drawX, drawY);

            const xTrans = size * .334 * Math.sin(performance.now() / 1250 + entity.id * Math.PI / 6) * scale;

            ctx.beginPath();
            ctx.arc(0, 0, size + 2.5 * scale, 0, Math.PI * 2);
            ctx.moveTo(-size, 0);
            ctx.lineTo(xTrans, size * 2.5);
            ctx.lineTo(size, 0);
            ctx.strokeStyle = colors["???"];
            ctx.lineWidth = 2.5 * scale;
            ctx.stroke();

            ctx.translate(xTrans, size * 2.5);
            ctx.scale(size * .6, size * .6);
            ctx.rotate(performance.now() / 1000 + entity.id * 5);
            drawAmulet(ctx, false);
            ctx.restore();
        }

        if (entity.wearing & WEARABLES.ARMOR) {
            ctx.save();
            ctx.translate(drawX, drawY);
            ctx.rotate(performance.now() / 250 + entity.id * 5);
            ctx.scale(size * 1.325, size * 1.325);
            drawArmor(ctx);
            ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(drawX, drawY, size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();

        ctx.translate(drawX, drawY);
        drawFace(size * .425, entity.facing, entity.mood, entity.mouthDip, expression);
        ctx.translate(-drawX, -drawY);

        if (entity.wearing & WEARABLES.THIRD_EYE) {
            ctx.save();
            ctx.translate(drawX, drawY - size * .6);
            ctx.scale(size * .3, size * .3);
            drawThirdEye(ctx, false);
            ctx.restore();
        }

        if (entity.wearing & WEARABLES.ANTENNAE) {
            ctx.save();
            ctx.translate(drawX, drawY - size * .8);
            ctx.scale(size * .9, size * .9);
            drawAntennae(ctx);
            ctx.restore();
        }

        if (options.showHitboxes) {
            ctx.beginPath();
            ctx.arc(drawX, drawY, size, 0, Math.PI * 2);
            ctx.lineWidth = 1.5 * scale;
            ctx.strokeStyle = colors["???"];
            ctx.stroke();
        }

        drawBar(drawX - size, drawX + size, drawY + size + 16 * scale, 6 * scale, colors["???"]);
        drawBar(drawX - size, drawX - size + size * 2 * entity.secondaryHealthBar, drawY + size + 16 * scale, 4 * scale, colors.legendary);
        drawBar(drawX - size, drawX - size + size * 2 * entity.healthRatio, drawY + size + 16 * scale, 4 * scale, entity.poisoned ? mixColors(colors.common, colors.irisPurple, .5 + Math.sin(performance.now() / 333 + entity.id * 3) * .5) : colors.common);

        if (entity.shieldRatio > 0) {
            drawBar(drawX - size, drawX - size + size * 2 * entity.shieldRatio, drawY + size + 16 * scale, 2.5 * scale, colors.unique);
        }

        if (!options.hideEntityUI && entity.id !== net.state.playerID) {
            // Like mob bar
            ctx.textAlign = "left";
            text(entity.name, drawX - size, drawY + size + 9 * scale, 8 * scale, entity.nameColor);

            ctx.textAlign = "right";
            text("Lvl " + entity.level, drawX + size, drawY + size + 24 * scale, 8 * scale, net.state.tiers[entity.rarity].color);

            ctx.textAlign = "center";
        }
    });

    net.state.lightning.forEach(lightning => {
        const alpha = lightning.alpha;

        if (alpha <= 0) {
            net.state.lightning.delete(lightning.id);
            return;
        }

        ctx.beginPath();
        ctx.moveTo(lightning.points[0].x * scale - cameraX + halfWidth, lightning.points[0].y * scale - cameraY + halfHeight);
        for (let i = 1; i < lightning.points.length; i++) {
            ctx.lineTo(lightning.points[i].x * scale - cameraX + halfWidth, lightning.points[i].y * scale - cameraY + halfHeight);
        }
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = colors.lightningTeal;
        ctx.globalAlpha = alpha;
        ctx.stroke();
    });

    ctx.globalAlpha = 1;

    if (options.useTileBackground && net.state.socket?.readyState === WebSocket.OPEN) {
        drawBackgroundOverlay(cameraX, cameraY, scale, BIOME_BACKGROUNDS[net.state.room.biome]);
    }

    if (net.state.terrain !== null && net.state.terrain.overlay !== null && net.state.room.biome === BIOME_TYPES.HALLOWEEN) {
        net.state.terrain.overlay.render(ctx, cameraX, cameraY, net.state.camera.lightingBoost, net.state.room.width * scale, net.state.room.width * scale, scale, halfWidth, halfHeight);
    }

    const uScale = uiScale();
    ctx.save();
    ctx.scale(uScale, uScale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const width = canvas.width / uScale;
    const height = canvas.height / uScale;
    const mX = mouse.x / uScale;
    const mY = mouse.y / uScale;
    net.state.petalHover = null;

    if (net.state.slots.length > 0) { // Slots
        const boxSize = net.state.isInDestroy ? 64 * .75 : 65;
        const padding = 10;

        const secondaryBoxSize = net.state.isInDestroy ? 65 : boxSize * .75;

        if (dragConfig.enabled) {
            dragConfig.item.realSize = boxSize;
        }

        if (net.state.isInDestroy) {
            text("(Press the keybind to destroy the item)", width / 2, height - boxSize - secondaryBoxSize - padding * 4, 15);
        }

        for (let i = 0; i < net.state.slots.length; i++) {
            const slot = net.state.slots[i];
            const x = width / 2 - (boxSize + padding) * net.state.slots.length / 2 + (boxSize + padding) * i + padding / 2;
            const y = height - boxSize - secondaryBoxSize - padding * 3;

            ctx.fillStyle = mixColors(colors.unique, "#000000", .2);
            ctx.fillRect(x, y, boxSize, boxSize);
            ctx.fillStyle = colors.unique;
            ctx.fillRect(x + 4, y + 4, boxSize - 8, boxSize - 8);

            if (slot.index !== -1 && ((!dragConfig.enabled || dragConfig.type !== DRAG_TYPE_MAINDOCKER) || dragConfig.index !== i)) {
                if (slot.icon === undefined) {
                    slot.icon = new net.IconItem();
                    slot.icon.realX = slot.icon.x = x;
                    slot.icon.realY = slot.icon.y = y;
                    slot.icon.realSize = slot.icon.size = boxSize;
                }

                slot.icon.interpolate();
                slot.icon.realX = x;
                slot.icon.realY = y;
                slot.icon.realSize = boxSize;

                if (slot.ratio > slot.realRatio) {
                    slot.ratio = slot.realRatio;
                } else {
                    slot.ratio = lerp(slot.ratio, slot.realRatio, .1);
                }

                if (slot.ratio < .995) {
                    drawPetalIconWithRatio(slot.index, slot.rarity, x, y, boxSize, slot.ratio, ctx);
                } else {
                    ctx.save();
                    ctx.translate(slot.icon.x, slot.icon.y);
                    ctx.scale(slot.icon.size, slot.icon.size);
                    ctx.drawImage(getPetalIcon(slot.index, slot.rarity), 0, 0, 1, 1);
                    ctx.restore();
                }

                if (mX > x && mX < x + boxSize && mY > y && mY < y + boxSize) {
                    net.state.petalHover = [slot.index, slot.rarity];

                    if (mouse.left && !dragConfig.enabled) {
                        beginDragDrop(x + boxSize / 2, y + boxSize / 2, boxSize, slot.index, slot.rarity);
                        dragConfig.type = DRAG_TYPE_MAINDOCKER;
                        dragConfig.index = i;
                        dragConfig.item.stableSize = boxSize;

                        dragConfig.onDrop = () => {
                            if (!processDrop()) {
                                slot.icon.x = mouse.x / uScale - boxSize / 2;
                                slot.icon.y = mouse.y / uScale - boxSize / 2;
                            }
                        }
                    }
                }
            }
        }

        if (net.state.secondarySlots.length > 0) {
            const y = height - secondaryBoxSize - padding * 2;
            if (dragConfig.enabled) {
                // If the drag item is within this row, make the size secondaryBoxSize
                const barWidth = secondaryBoxSize * net.state.slots.length + padding * (net.state.slots.length + 1);
                const barX = width / 2 - barWidth / 2;
                const barY = height - secondaryBoxSize - padding;

                if (dragConfig.item.x > barX && dragConfig.item.x < barX + barWidth && dragConfig.item.y > barY && dragConfig.item.y < barY + secondaryBoxSize) {
                    dragConfig.item.realSize = secondaryBoxSize;
                }
            }

            const minXOfSecondary = width / 2 - (secondaryBoxSize + padding) * net.state.slots.length / 2 + padding / 2;
            text("[x]", minXOfSecondary - secondaryBoxSize / 2, y + secondaryBoxSize / 2, 15);

            for (let i = 0; i < net.state.slots.length; i++) {
                const slot = net.state.secondarySlots[i];
                const x = width / 2 - (secondaryBoxSize + padding) * net.state.slots.length / 2 + (secondaryBoxSize + padding) * i + padding / 2;

                ctx.fillStyle = mixColors(colors.unique, "#000000", .2);
                ctx.fillRect(x, y, secondaryBoxSize, secondaryBoxSize);
                ctx.fillStyle = colors.unique;
                ctx.fillRect(x + 3, y + 3, secondaryBoxSize - 6, secondaryBoxSize - 6);

                if (slot.icon === undefined) {
                    slot.icon = new net.IconItem();
                    slot.icon.realX = slot.icon.x = x;
                    slot.icon.realY = slot.icon.y = y;
                    slot.icon.realSize = slot.icon.size = secondaryBoxSize;
                }

                slot.icon.interpolate();
                slot.icon.realX = x;
                slot.icon.realY = y;
                slot.icon.realSize = secondaryBoxSize;

                if (slot.index > -1 && ((!dragConfig.enabled || dragConfig.type !== DRAG_TYPE_SECONDARYDOCKER) || dragConfig.index !== i)) {
                    ctx.save();
                    ctx.translate(slot.icon.x, slot.icon.y);
                    ctx.scale(slot.icon.size, slot.icon.size);
                    ctx.drawImage(getPetalIcon(slot.index, slot.rarity), 0, 0, 1, 1);
                    ctx.restore();

                    if (mX > x && mX < x + secondaryBoxSize && mY > y && mY < y + secondaryBoxSize) {
                        net.state.petalHover = [slot.index, slot.rarity];

                        if (mouse.left && !dragConfig.enabled) {
                            beginDragDrop(x + boxSize / 2, y + boxSize / 2, boxSize, slot.index, slot.rarity);
                            dragConfig.type = DRAG_TYPE_SECONDARYDOCKER;
                            dragConfig.index = i;
                            dragConfig.item.stableSize = secondaryBoxSize;

                            dragConfig.onDrop = () => {
                                if (!processDrop()) {
                                    slot.icon.x = mouse.x / uScale - boxSize / 2;
                                    slot.icon.y = mouse.y / uScale - boxSize / 2;
                                }
                            }
                        }
                    }
                }

                // Keybind
                text(`[${(i + 1) % 10}]`, x + secondaryBoxSize / 2, y + secondaryBoxSize + padding, 12);
            }
        }

        if (net.state.slots.length > 0) {
            const maxXOfSecondary = width / 2 - (secondaryBoxSize + padding) * net.state.slots.length / 2 + (secondaryBoxSize + padding) * net.state.slots.length + padding / 2 + secondaryBoxSize / 2;
            const y = height - secondaryBoxSize - padding * 2;

            net.state.destroyIcon.realX = maxXOfSecondary;
            net.state.destroyIcon.realY = y;
            net.state.destroyIcon.realSize = secondaryBoxSize;
            net.state.destroyIcon.interpolate();

            ctx.fillStyle = mixColors(colors.skillTree, "#000000", .2);
            ctx.fillRect(maxXOfSecondary, y, secondaryBoxSize, secondaryBoxSize);
            ctx.fillStyle = colors.skillTree;
            ctx.fillRect(maxXOfSecondary + 3, y + 3, secondaryBoxSize - 6, secondaryBoxSize - 6);
            text("Destroy", maxXOfSecondary + secondaryBoxSize / 2, y + secondaryBoxSize / 2, secondaryBoxSize / 5);
            text("[k]", maxXOfSecondary + secondaryBoxSize / 2, y + secondaryBoxSize + padding, 12);
        }
    }

    if (net.state.socket?.readyState === WebSocket.OPEN) {
        { // Level
            net.state.levelProgress = lerp(net.state.levelProgress, net.state.levelProgressTarget, .1);

            if (net.state.levelProgressTarget < net.state.levelProgress) {
                net.state.levelProgress = 0;
            }

            const player = net.state.players.get(net.state.playerID);
            drawBar(50, 275, 175, 37.5, colors["???"]);

            ctx.save();
            ctx.translate(50, 175);
            ctx.beginPath();
            ctx.arc(0, 0, 35, 0, Math.PI * 2);
            setStyle(colors.playerYellow, 4);
            ctx.fill();
            ctx.stroke();

            if (player) {
                drawFace(35 * .425, player.facing, player.mood, player.mouthDip, player.attack ? 2 : player.defend ? 3 : 1);
                drawBar(70, 70 + 155 * player.secondaryHealthBar, 0, 25, colors.legendary);
                drawBar(70, 70 + 155 * player.healthRatio, 0, 27.5, player.poisoned ? mixColors(colors.common, colors.irisPurple, .5 + Math.sin(performance.now() / 333 + player.id * 3) * .5) : colors.common);
                cuteLittleAnimations.nameText = lerp(cuteLittleAnimations.nameText, 197.5, .1);
            } else {
                drawFace(35 * .425, 0, 1, 1, 1, true);
                cuteLittleAnimations.nameText = lerp(cuteLittleAnimations.nameText, 180, .1);
            }

            ctx.restore();

            text(net.state.username, cuteLittleAnimations.nameText, 175, 20);

            drawBar(175, 275, 210, 22.5, colors["???"]);
            drawBar(175, 175 + 100 * net.state.levelProgress, 210, 15, colors.playerYellow);
            text("Level " + net.state.level, 225, 210, 12);
        }

        if (!isHalloween || net.state.room.biome !== BIOME_TYPES.HALLOWEEN) { // Minimap
            const doTerrain = net.state.terrain?.blocks?.length > 0;
            const biggestSize = doTerrain ? 275 : Math.abs(1 - net.state.room.width / net.state.room.height) < .1 ? 150 : 200;
            const bigger = Math.max(net.state.room.width, net.state.room.height);
            const mapWidth = net.state.room.width / bigger * biggestSize;
            const mapHeight = net.state.room.height / bigger * biggestSize;

            const x = width - mapWidth - 10;
            const y = height - mapHeight - 10;

            if (doTerrain) {
                ctx.drawImage(net.state.minimapImg, x, y, mapWidth, mapHeight);
            } else {
                ctx.fillStyle = BIOME_BACKGROUNDS[net.state.room.biome].color;
                ctx.strokeStyle = "#444444";
                ctx.lineWidth = 5;
                ctx.beginPath();

                if (net.state.room.isRadial) {
                    ctx.arc(x + mapWidth / 2, y + mapHeight / 2, mapWidth / 2, 0, Math.PI * 2);
                } else {
                    ctx.roundRect(x, y, mapWidth, mapHeight, 10);
                }

                ctx.fill();
                ctx.stroke();
            }

            ctx.fillStyle = doTerrain ? colors.peaGreen : colors.playerYellow;
            ctx.beginPath();
            ctx.arc(
                net.state.camera.x / net.state.room.width * mapWidth + x + mapWidth / 2,
                net.state.camera.y / net.state.room.height * mapHeight + y + mapHeight / 2,
                biggestSize * (doTerrain ? .0225 : .025), 0, Math.PI * 2
            );
            ctx.fill();
        }

        { // Chat
            ctx.save();
            ctx.translate(10, height - 10);
            const maxWidth = width * .2;
            const heights = [];
            const messages = net.ChatMessage.messages;
            const msgSize = 18;

            for (let i = 0; i < messages.length; i++) {
                heights.push(drawWrappedText(messages[i].completeMessage, -2048, -2048, msgSize, maxWidth));
            }

            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            let y = -10;

            const maxY = heights.reduce((a, b) => a + b, 0) + 10 * messages.length + (net.ChatMessage.showInput ? 45 : 30);
            cuteLittleAnimations.chatBGSize = lerp(cuteLittleAnimations.chatBGSize, maxY, .1);

            ctx.fillStyle = "rgba(0, 0, 0, .5)";
            ctx.beginPath();
            ctx.roundRect(-12, -cuteLittleAnimations.chatBGSize - 10, maxWidth + 22, cuteLittleAnimations.chatBGSize + 22, 5);
            ctx.fill();

            if (net.ChatMessage.showInput) {
                const element = net.ChatMessage.element;

                element.style.display = "block";
                element.style.left = `${10 * uScale}px`;
                element.style.bottom = `${10 * uScale}px`;
                element.style.width = `${+getComputedStyle(canvas).width.replace("px", "") * .2 - 10 * uScale}px`;
                element.style.height = `${20 * uScale}px`;
                element.style.fontSize = `${msgSize * uScale}px`;
                element.style.padding = `${5 * uScale}px`;

                y -= 45;
            } else {
                net.ChatMessage.element.style.display = "none";
                text("(Press Esc to open chat)", 0, y, msgSize);

                y -= 30;
            }

            ctx.textBaseline = "top";
            y -= heights[heights.length - 1];

            for (let i = messages.length - 1; i >= 0; i--) {
                const message = messages[i];

                message.y = lerp(message.y, y, .2);
                message.ticker++;

                if (message.ticker > (clientDebug.fps * 7.5) - messages.length * 2) {
                    net.ChatMessage.messages.splice(i, 1);
                    continue;
                }

                switch (message.type) {
                    case 0: // Chat
                        const nameWidth = text(message.username, 0, message.y, msgSize, message.color);
                        drawWrappedText(": " + message.message, nameWidth, message.y, msgSize, maxWidth - 5, "#FFFFFF", ctx, 0);
                        break;
                    case 1: // System
                        drawWrappedText(message.message, 0, message.y, msgSize, maxWidth - 5, message.color);
                        break;
                }

                if (i > 0) {
                    y -= heights[i - 1];
                    y -= 10;
                }
            }

            ctx.restore();
        }
    }

    if (net.state.waveInfo !== null) { // Wave info
        ctx.textBaseline = "middle";
        text("Wave " + net.state.waveInfo.wave, width / 2, 30, 35);
        drawBar(width / 2 - 200, width / 2 + 200, 65, 30, colors["???"]);
        drawBar(width / 2 - 200, width / 2 - 200 + 400 * (net.state.waveInfo.livingMobs / net.state.waveInfo.maxMobs), 65, 25, colors.common);
        text(net.state.waveInfo.livingMobs + " / " + net.state.waveInfo.maxMobs, width / 2, 65, 22.5);
    }

    if (net.state.petalHover !== null) { // Tooltip
        ctx.save();
        ctx.translate(width - 360, 10 + (options.showDebug ? 40 : 0));
        const img = petalTooltip(...net.state.petalHover);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, 350, 350 * img.height / img.width);
        ctx.restore();
    }

    updateAndDrawDragDrop(mX, mY);

    if (net.state.isDead) {
        ctx.fillStyle = "rgba(0, 0, 0, .2)";
        ctx.fillRect(0, 0, width, height);
        text("You died", width / 2, height / 2, 30);
        text(net.state.killMessage, width / 2, height / 2 + 30, 15);
        text("(Press ENTER to respawn)", width / 2, height / 2 + 60, 15);
    }

    if (options.showDebug) {
        ctx.textAlign = "right";
        ctx.textBaseline = "top";

        text(`C: ${clientDebug.fps} FPS | ${clientDebug.mspt.toFixed(2)} mspt`, width - 10, 10, 15);
        text(`S: ${net.state.updateRate} UPS | ${+net.state.ping.toFixed(2)} ms ping`, width - 10, 25, 15);

        if (net.state.socket) {
            text(`B(I/O): ${net.state.socket.bandWidth.in}/${net.state.socket.bandWidth.out} KB/s`, width - 10, 40, 15);
        } else {
            text("Not connected", width - 10, 40, 15);
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
    }

    ctx.restore();

    clientDebug.frames++;
    clientDebug.totalTime += performance.now() - start;
}

draw();

if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    document.getElementById("gamemodeSelect").appendChild(new Option("loc maze", "maze"));
}

if (isHalloween) {
    document.getElementById("biomeSelect").appendChild(new Option("Halloween", "halloween"));
}

document.getElementById("usernameInputInput").value = localStorage.getItem("username") || "guest";
document.getElementById("gamemodeSelect").value = localStorage.getItem("gamemode") || "ffa";
document.getElementById("biomeSelect").value = localStorage.getItem("biome") || "default";
document.getElementById("enableMods").checked = localStorage.getItem("enableMods") === "true";
document.getElementById("privateLobby").checked = localStorage.getItem("privateLobby") === "true";

showMenus();
loadAndRenderChangelogs();