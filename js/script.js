import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ChainInteraction } from "./chainInteraction.js";

let scene;
let camera;
let renderer;
let chainLinks = [];
let echoes = [];
let linkModel;
let linkSpacing = 0.75;
let linkHalfHeight = 0.4;
let cameraMinY = -1;
let cameraMaxY = 1;
let zoomMinZ = 4;
let zoomMaxZ = 20;
let chainInteraction;

const scrollSensitivity = 0.01;

const canvas = document.getElementById("chainCanvas");
const statusMessage = document.getElementById("statusMessage");
const zoomSlider = document.getElementById("zoomSlider");
const chainModelUrl = `assets/Chain.glb?cacheBust=${Date.now()}`;

window.addEventListener("error", (event) => {
    const message = event.error?.message || event.message || "Unknown runtime error";
    console.error("Runtime error", event.error || event);
    setStatus(`Runtime error: ${message}`);
});

window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection", event.reason);
    setStatus(`Unhandled error: ${event.reason?.message || event.reason || "Unknown promise rejection"}`);
});

init();
loadChainLink();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 4);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 1.5);
    fillLight.position.set(-4, 2, 3);
    scene.add(fillLight);

    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);

    chainInteraction = new ChainInteraction({
        canvas,
        camera,
        getChainLinks: () => chainLinks,
        getLinkSpacing: () => linkSpacing,
    });
    chainInteraction.attach();

    window.addEventListener("resize", onWindowResize);
    window.addEventListener("wheel", onMouseWheel, { passive: false });

    animate();
}

function loadChainLink() {
    const loader = new GLTFLoader();

    loader.load(
        chainModelUrl,
        (gltf) => {
            linkModel = gltf.scene;
            normalizeModel(linkModel);
            configureLinkLayout(linkModel);
            fitCameraToObject(linkModel);
            setStatus("Chain model loaded.");
            addLink();
        },
        undefined,
        (error) => {
            console.error("Failed to load Chain.glb", error);
            setStatus("Chain model failed to load. Serve this folder through a local web server instead of opening index.html directly.");
        }
    );
}

function normalizeModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);

    if (maxDimension > 0) {
        const scale = 1.5 / maxDimension;
        model.scale.setScalar(scale);
    }

    box.setFromObject(model);
    box.getCenter(center);
    model.position.sub(center);
}

function configureLinkLayout(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const verticalSize = size.y > 0 ? size.y : maxDimension;

    linkSpacing = Math.max(0.15, verticalSize * 0.58);
    linkHalfHeight = Math.max(0.08, verticalSize * 0.5);
}

function fitCameraToObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const fitHeightDistance = maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = Math.max(fitHeightDistance, fitWidthDistance) * 2.6;

    camera.position.set(0, 0, distance || 4);
    camera.lookAt(0, 0, 0);
    camera.near = 0.01;
    camera.far = Math.max(100, distance * 10);
    camera.updateProjectionMatrix();

    zoomMinZ = camera.position.z;
    updateZoomLimits();
    updateCameraVerticalLimits();
}

function updateZoomLimits() {
    if (chainLinks.length <= 1) {
        zoomMaxZ = zoomMinZ;
        syncZoomSlider();
        return;
    }

    const chainHeight = (chainLinks.length - 1) * linkSpacing + linkHalfHeight * 2;
    const fitAll = (chainHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    zoomMaxZ = Math.max(fitAll * 1.2, zoomMinZ);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, zoomMinZ, zoomMaxZ);
    syncZoomSlider();
}

function updateCameraVerticalLimits() {
    if (chainLinks.length === 0) {
        cameraMinY = -linkHalfHeight;
        cameraMaxY = linkHalfHeight;
    } else {
        const topY = 0 + linkHalfHeight;
        const bottomY = -(chainLinks.length - 1) * linkSpacing - linkHalfHeight;
        const padding = Math.max(0.08, linkHalfHeight * 0.4);

        cameraMaxY = topY + padding;
        cameraMinY = bottomY - padding;
    }

    camera.position.y = THREE.MathUtils.clamp(camera.position.y, cameraMinY, cameraMaxY);
    camera.lookAt(0, camera.position.y, 0);
}

function onMouseWheel(event) {
    if (chainLinks.length === 0) {
        return;
    }

    event.preventDefault();

    if (event.ctrlKey) {
        const zoomSpeed = 0.1;
        camera.position.z += event.deltaY * scrollSensitivity * camera.position.z * zoomSpeed * 60;
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, zoomMinZ, zoomMaxZ);
        syncZoomSlider();
    } else {
        const scrollStep = Math.max(0.05, linkSpacing * 0.35);
        camera.position.y -= event.deltaY * scrollSensitivity * scrollStep;
        camera.position.y = THREE.MathUtils.clamp(camera.position.y, cameraMinY, cameraMaxY);
        camera.lookAt(0, camera.position.y, 0);
    }
}

function addLink() {
    if (!linkModel) {
        setStatus("Chain model is not ready yet.");
        return;
    }

    const linkIndex = chainLinks.length;
    const newLink = linkModel.clone(true);
    const offset = linkIndex * linkSpacing;

    if (linkIndex % 2 === 1) {
        newLink.rotation.y = Math.PI / 2;
    }

    newLink.position.y = -offset;
    scene.add(newLink);
    chainLinks.push(newLink);
    chainInteraction.rebuildFromLinks();
    chainInteraction.applyToLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    setStatus(`Chain links: ${chainLinks.length}`);
}

function addEchoWithData(title, description) {
    addLink();
    echoes.push({ title, description, index: chainLinks.length - 1 });
    renderEchoLabels();
}

function removeLink() {
    if (chainLinks.length === 0) {
        return;
    }

    const lastLink = chainLinks.pop();
    scene.remove(lastLink);
    
    // Remove corresponding echo if it exists
    if (echoes.length > 0) {
        echoes.pop();
        renderEchoLabels();
    }
    
    chainInteraction.rebuildFromLinks();
    chainInteraction.applyToLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    setStatus(`Chain links: ${chainLinks.length}`);
}

function setStatus(message) {
    if (message.startsWith("Chain links: ")) {
        const number = message.replace("Chain links: ", "");
        statusMessage.innerHTML = `<span style="font-size: 14px;">Chain links: </span><span style="font-size: 24px;">${number}</span>`;
        statusMessage.style.display = "flex";
        statusMessage.style.alignItems = "center";
        statusMessage.style.gap = "4px";
    } else {
        statusMessage.textContent = message;
        statusMessage.style.display = "block";
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function syncZoomSlider() {
    if (!zoomSlider) {
        return;
    }

    if (zoomMaxZ <= zoomMinZ) {
        zoomSlider.value = "0";
        return;
    }

    const ratio = (camera.position.z - zoomMinZ) / (zoomMaxZ - zoomMinZ);
    const clampedRatio = THREE.MathUtils.clamp(ratio, 0, 1);
    zoomSlider.value = String(Math.round(clampedRatio * 100));
}

function applyZoomFromSlider() {
    if (!zoomSlider || zoomMaxZ <= zoomMinZ) {
        return;
    }

    const ratio = Number(zoomSlider.value) / 100;
    camera.position.z = THREE.MathUtils.lerp(zoomMinZ, zoomMaxZ, ratio);
}

if (zoomSlider) {
    zoomSlider.addEventListener("input", applyZoomFromSlider);
}

document.getElementById("addEcho").onclick = openEchoModal;

// Echo Modal Functions
function openEchoModal() {
    const modal = document.getElementById("echoModal");
    modal.classList.remove("hidden");
}

function closeEchoModal() {
    const modal = document.getElementById("echoModal");
    modal.classList.add("hidden");
}

document.getElementById("confirmEcho").onclick = () => {
    const title = document.getElementById("titleInput").value;
    const description = document.getElementById("descriptionInput").value;
    
    if (title.trim() || description.trim()) {
        addEchoWithData(title, description);
        
        // Clear the inputs
        document.getElementById("titleInput").value = "";
        document.getElementById("descriptionInput").value = "";
        
        // Close the modal
        closeEchoModal();
    }
};

document.getElementById("cancelEcho").onclick = closeEchoModal;

// Echo Label and Hero Card Functions
function openHeroCard(echoIndex) {
    const echo = echoes[echoIndex];
    if (!echo) {
        return;
    }
    const heroCardContent = document.getElementById("heroCardContent");
    heroCardContent.innerHTML = `
        <h2>${echo.title || "Echo"}</h2>
        <p>${echo.description || ""}</p>
    `;
    
    document.getElementById("heroCardOverlay").classList.remove("hidden");
    document.getElementById("heroCard").classList.remove("hidden");
}

function closeHeroCard() {
    document.getElementById("heroCardOverlay").classList.add("hidden");
    document.getElementById("heroCard").classList.add("hidden");
}

function renderEchoLabels() {
    const container = document.getElementById("echoLabelsContainer");
    container.innerHTML = "";
    
    echoes.forEach((echo, echoIndex) => {
        const label = document.createElement("div");
        label.className = "echo-label";
        label.textContent = echo.title || "Echo";
        label.style.cursor = "pointer";
        label.dataset.echoIndex = String(echoIndex);
        label.dataset.linkIndex = String(echo.index);
        label.onclick = (e) => {
            e.stopPropagation();
            openHeroCard(echoIndex);
        };
        
        container.appendChild(label);
    });

    updateEchoLabelPositions();
}

function updateEchoLabelPositions() {
    const labels = document.querySelectorAll(".echo-label");

    labels.forEach((labelElement) => {
        const linkIndex = Number(labelElement.dataset.linkIndex);
        const link = chainLinks[linkIndex];
        if (!link) {
            return;
        }

        const linkWorldPos = new THREE.Vector3();
        link.getWorldPosition(linkWorldPos);

        const screenPos = linkWorldPos.clone().project(camera);
        const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

        labelElement.style.left = (x + 20) + "px";
        labelElement.style.top = (y - 15) + "px";
        labelElement.style.transform = "translate(0, -50%)";
    });
}

// Setup hero card event listeners with a small delay to ensure DOM is ready
const setupHeroCardListeners = () => {
    const closeBtn = document.getElementById("closeHeroCard");
    const overlay = document.getElementById("heroCardOverlay");
    if (closeBtn) {
        closeBtn.onclick = closeHeroCard;
    }
    if (overlay) {
        overlay.onclick = closeHeroCard;
    }
};

// Try to setup immediately, then again after a tiny delay
setupHeroCardListeners();
setTimeout(setupHeroCardListeners, 100);

// Settings screen
document.getElementById("settingsBtn").onclick = () => {
    document.getElementById("settingsOverlay").classList.remove("hidden");
    document.getElementById("settingsScreen").classList.remove("hidden");
};

document.getElementById("settingsOverlay").addEventListener("click", closeSettings);

function closeSettings() {
    document.getElementById("settingsOverlay").classList.add("hidden");
    document.getElementById("settingsScreen").classList.add("hidden");
}

document.getElementById("resetChainBtn").onclick = () => {
    // Remove all chain links from scene
    for (const link of chainLinks) {
        scene.remove(link);
    }
    chainLinks.length = 0;
    echoes.length = 0;

    // Clear label elements
    document.getElementById("echoLabelsContainer").innerHTML = "";

    chainInteraction.rebuildFromLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    setStatus("Chain links: 0");
    closeSettings();
};

function animate() {
    requestAnimationFrame(animate);
    chainInteraction.update();
    renderer.render(scene, camera);
    updateEchoLabelPositions();
}
