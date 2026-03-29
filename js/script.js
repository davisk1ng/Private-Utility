import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { ChainInteraction } from "./chainInteraction.js";
import { DogTagManager } from "./dogTagManager.js";

let scene;
let camera;
let renderer;
let chainLinks = [];
let linkModel;
let linkSpacing = 0.75;
let linkHalfHeight = 0.4;
let cameraMinY = -1;
let cameraMaxY = 1;
let zoomMinZ = 4;
let zoomMaxZ = 20;
let chainInteraction;
let dogTagManager;
let selectedTagId = null;
let isRestoring = false;
let heroPreviewRenderer = null;
let heroPreviewScene = null;
let heroPreviewCamera = null;
let heroPreviewRoot = null;
let heroPreviewBackLabel = null;
let heroPreviewFrontLabels = [];
let heroFlipAngle = 0;
let heroFlipTarget = 0;
let heroFlipRafId = null;
let heroPreviewIsQuarterTurn = false;
const heroPreviewBasePosition = new THREE.Vector3();
const heroPreviewCameraRight = new THREE.Vector3();

// Post-flip horizontal correction controls:
// Positive moves right, negative moves left.
const heroFlipXOffsetFrontFacing = -0.2;
const heroFlipXOffsetQuarterTurn = .38;

const tagTextLodDistance = 3.2;
const scrollSensitivity = 0.01;
const chainModelUrl = `assets/Chain.glb?cacheBust=${Date.now()}`;
const dogTagModelUrl = `assets/DogTag.glb?cacheBust=${Date.now()}`;
const fontUrl = "https://unpkg.com/three@0.152.2/examples/fonts/droid/droid_sans_mono_regular.typeface.json";

const tmpWorld = new THREE.Vector3();

const canvas = document.getElementById("chainCanvas");
const statusMessage = document.getElementById("statusMessage");
const zoomSlider = document.getElementById("zoomSlider");
const splashScreen = document.getElementById("splashScreen");
const removeTagBtn = document.getElementById("removeTagBtn");
const titleInput = document.getElementById("titleInput");
const titleCharCount = document.getElementById("titleCharCount");
const hideUiBtn = document.getElementById("hideUiBtn");

let isUiHidden = false;

let isTouchScrolling = false;
let activeTouchScrollId = null;
let lastTouchClientY = 0;

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
loadAssets();

restoreUiVisibilityPreference();

function hideSplashScreen() {
    if (!splashScreen || splashScreen.classList.contains("hidden") || splashScreen.classList.contains("is-hiding")) {
        return;
    }

    splashScreen.classList.add("is-hiding");
    window.setTimeout(() => {
        splashScreen.classList.add("hidden");
    }, 700);
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7e7e7);

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

    dogTagManager = new DogTagManager({
        scene,
        renderer,
        getChainLinks: () => chainLinks,
        getLinkHalfHeight: () => linkHalfHeight,
    });

    window.addEventListener("resize", onWindowResize);
    window.addEventListener("wheel", onMouseWheel, { passive: false });
    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("pointerdown", onCanvasPointerDown, { passive: true });
    window.addEventListener("pointermove", onCanvasPointerMove, { passive: false });
    window.addEventListener("pointerup", onCanvasPointerUp, { passive: true });
    window.addEventListener("pointercancel", onCanvasPointerUp, { passive: true });

    syncAppHeight();
    window.addEventListener("orientationchange", syncAppHeight);

    animate();
}

function syncAppHeight() {
    // Use innerHeight (stable layout height) not visualViewport.height which
    // shrinks when the Safari toolbar appears, causing the canvas to fall short.
    const appHeight = window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${appHeight}px`);
}

async function loadAssets() {
    setStatus("Loading models...");

    try {
        const [chain, dogTag] = await Promise.all([
            loadModel(chainModelUrl),
            loadModel(dogTagModelUrl),
        ]);

        let font = null;
        try {
            font = await loadFont(fontUrl);
        } catch (fontError) {
            console.warn("Text font failed to load; using canvas-only labels", fontError);
        }

        linkModel = chain;

        normalizeModel(linkModel, 1.5);
        configureLinkLayout(linkModel);
        normalizeModelToHeight(dogTag, linkHalfHeight * 2);
        dogTagManager.configureDogTagModel(dogTag);
        dogTagManager.setAssets({ dogTagModel: dogTag, textFont: font });
        fitCameraToObject(linkModel);

        setStatus(font ? "Chain and dog tag models loaded." : "Chain and dog tag models loaded (font unavailable, using canvas text).");

        if (!restoreChain()) {
            addLink();
        }

        hideSplashScreen();
    } catch (error) {
        console.error("Failed to load assets", error);
        const details = error?.message || error?.toString?.() || "Unknown asset error";
        setStatus(`Failed to load 3D assets: ${details}`);
        hideSplashScreen();
    }
}

function loadModel(url) {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    loader.setDRACOLoader(dracoLoader);

    return new Promise((resolve, reject) => {
        loader.load(
            url,
            (gltf) => {
                dracoLoader.dispose();
                resolve(gltf.scene);
            },
            undefined,
            (error) => {
                dracoLoader.dispose();
                reject(error);
            }
        );
    });
}

function loadFont(url) {
    const loader = new FontLoader();
    return new Promise((resolve, reject) => {
        loader.load(url, (font) => resolve(font), undefined, (error) => reject(error));
    });
}

function normalizeModel(model, targetSize) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);

    if (maxDimension > 0 && targetSize > 0) {
        const scale = targetSize / maxDimension;
        model.scale.setScalar(scale);
    }

    box.setFromObject(model);
    box.getCenter(center);
    model.position.sub(center);
}

function normalizeModelToHeight(model, targetHeight) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    if (size.y <= 0 || targetHeight <= 0) {
        normalizeModel(model, Math.max(targetHeight, 0.1));
        return;
    }

    const scale = targetHeight / size.y;
    model.scale.setScalar(scale);

    const center = new THREE.Vector3();
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
        let topY = -Infinity;
        let bottomY = Infinity;

        for (const link of chainLinks) {
            topY = Math.max(topY, link.position.y + linkHalfHeight);
            bottomY = Math.min(bottomY, link.position.y - linkHalfHeight);
        }

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

    const newLink = linkModel.clone(true);

    if (chainLinks.length === 0) {
        newLink.position.set(0, 0, 0);
        chainLinks.push(newLink);
    } else {
        const topLink = chainLinks[0];
        newLink.position.copy(topLink.position);
        newLink.position.y += linkSpacing;
        chainLinks.unshift(newLink);

        dogTagManager.shiftIndices(1);
    }

    scene.add(newLink);
    chainInteraction.rebuildFromLinks();
    chainInteraction.applyToLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    setStatus(`Chain links: ${chainLinks.length}`);

    if (!isRestoring) {
        saveChain();
    }
}

function addDogTagWithTitle(title) {
    if (!dogTagManager.hasAssets()) {
        setStatus("Dog tag assets are still loading.");
        return;
    }

    addLink();

    dogTagManager.prependTag(title, 0);
    updateDogTagViewMode();

    if (!isRestoring) {
        saveChain();
    }
}

function removeLink() {
    if (chainLinks.length === 0) {
        return;
    }

    const firstLink = chainLinks.shift();
    scene.remove(firstLink);

    const removedTags = dogTagManager.removeAtIndex(0);
    for (const removedTag of removedTags) {
        if (selectedTagId === removedTag.id) {
            selectedTagId = null;
            closeHeroCard();
        }
    }

    chainInteraction.rebuildFromLinks();
    chainInteraction.applyToLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    setStatus(`Chain links: ${chainLinks.length}`);

    if (!isRestoring) {
        saveChain();
    }
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
    syncAppHeight();
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeHeroPreview();
}

function onCanvasPointerDown(event) {
    if (event.pointerType !== "touch") {
        return;
    }

    isTouchScrolling = true;
    activeTouchScrollId = event.pointerId;
    lastTouchClientY = event.clientY;
}

function onCanvasPointerMove(event) {
    if (!isTouchScrolling || event.pointerType !== "touch" || event.pointerId !== activeTouchScrollId) {
        return;
    }

    // Link dragging takes priority over camera scroll dragging.
    if (chainInteraction?.isDragging?.()) {
        lastTouchClientY = event.clientY;
        return;
    }

    const deltaY = event.clientY - lastTouchClientY;
    lastTouchClientY = event.clientY;

    const scrollStep = Math.max(0.05, linkSpacing * 0.35);
    camera.position.y += deltaY * scrollSensitivity * scrollStep * 1.6;
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, cameraMinY, cameraMaxY);
    camera.lookAt(0, camera.position.y, 0);

    if (event.cancelable) {
        event.preventDefault();
    }
}

function onCanvasPointerUp(event) {
    if (event.pointerType !== "touch" || event.pointerId !== activeTouchScrollId) {
        return;
    }

    isTouchScrolling = false;
    activeTouchScrollId = null;
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
    updateDogTagViewMode();
}

if (zoomSlider) {
    zoomSlider.addEventListener("input", applyZoomFromSlider);
}

document.getElementById("addEcho").onclick = openEchoModal;

function openEchoModal() {
    const modal = document.getElementById("echoModal");
    modal.classList.remove("hidden");
}

function closeEchoModal() {
    const modal = document.getElementById("echoModal");
    modal.classList.add("hidden");
}

function syncTitleCharCount() {
    if (!titleInput || !titleCharCount) {
        return;
    }
    titleCharCount.textContent = `${titleInput.value.length}/40`;
}

if (titleInput) {
    titleInput.addEventListener("input", syncTitleCharCount);
    syncTitleCharCount();
}

document.getElementById("confirmEcho").onclick = () => {
    const title = titleInput ? titleInput.value : "";

    if (title.trim()) {
        addDogTagWithTitle(title);
        if (titleInput) {
            titleInput.value = "";
        }
        syncTitleCharCount();
        closeEchoModal();
    }
};

document.getElementById("cancelEcho").onclick = closeEchoModal;

if (removeTagBtn) {
    removeTagBtn.onclick = () => {
        if (selectedTagId === null) {
            return;
        }

        const removed = dogTagManager.removeTagById(selectedTagId);
        if (!removed) {
            return;
        }

        const removedLink = chainLinks.splice(removed.index, 1)[0];
        if (removedLink) {
            scene.remove(removedLink);
        }

        dogTagManager.refreshAttachments();
        chainInteraction.rebuildFromLinks();
        chainInteraction.applyToLinks();
        updateZoomLimits();
        updateCameraVerticalLimits();
        setStatus(`Chain links: ${chainLinks.length}`);

        selectedTagId = null;
        closeHeroCard();
        updateDogTagViewMode();
        saveChain();
    };
}

function onCanvasClick(event) {
    const tag = dogTagManager.pickTagFromEvent(event, canvas, camera);
    if (!tag) {
        selectedTagId = null;
        closeHeroCard();
        updateDogTagViewMode();
        return;
    }

    selectedTagId = tag.id;
    openHeroCard(tag.id);
    focusCameraOnTag(tag);
    updateDogTagViewMode();
}

function focusCameraOnTag(tag) {
    tag.root.getWorldPosition(tmpWorld);

    camera.position.y = THREE.MathUtils.clamp(tmpWorld.y, cameraMinY, cameraMaxY);
    camera.position.z = Math.max(zoomMinZ, zoomMinZ * 1.08);
    camera.lookAt(0, camera.position.y, 0);
    syncZoomSlider();
}

function openHeroCard(tagId) {
    const tag = dogTagManager.getTagById(tagId);
    if (!tag) {
        return;
    }

    document.getElementById("heroPreviewOverlay").classList.remove("hidden");
    document.getElementById("heroPreviewStage").classList.remove("hidden");

    initHeroPreview(tag);
}

function closeHeroCard() {
    document.getElementById("heroPreviewOverlay").classList.add("hidden");
    document.getElementById("heroPreviewStage").classList.add("hidden");
    disposeHeroPreviewRenderer();
}

function initHeroPreview(tag) {
    const canvasEl = document.getElementById("heroPreviewCanvas");
    if (!canvasEl) {
        return;
    }

    disposeHeroPreviewRenderer();

    heroPreviewRenderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    heroPreviewRenderer.setClearColor(0x000000, 0);
    heroPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    heroPreviewScene = new THREE.Scene();
    heroPreviewCamera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2.2, 2.6, 3.1);
    heroPreviewScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-2, 1.2, 1.4);
    heroPreviewScene.add(fillLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    heroPreviewScene.add(ambient);

    heroPreviewRoot = tag.root.clone(true);
    heroPreviewRoot.position.set(0, 0, 0);
    heroPreviewRoot.rotation.set(0, 0, 0);
    heroPreviewRoot.scale.setScalar(1);
    const previewCanvasLabel = heroPreviewRoot.children[1];
    const previewTextLabel = heroPreviewRoot.children[2];

    if (previewCanvasLabel) {
        previewCanvasLabel.visible = false;
    }

    if (previewTextLabel) {
        previewTextLabel.visible = true;
    }

    heroPreviewScene.add(heroPreviewRoot);

    // Track the active front label for visibility toggling during flip
    heroPreviewFrontLabels = [];
    if (previewTextLabel) {
        heroPreviewFrontLabels.push(previewTextLabel);
    }

    // Create back-face date label (hidden until flipped)
    heroPreviewBackLabel = dogTagManager.createHeroBackDateMesh(tag.createdAt, previewTextLabel, tag.isQuarterTurn);
    heroPreviewBackLabel.visible = false;
    heroPreviewRoot.add(heroPreviewBackLabel);

    // Center the preview around its visual bounds so flip rotation stays in place.
    recenterObjectToBounds(heroPreviewRoot);
    heroPreviewIsQuarterTurn = !!tag.isQuarterTurn;
    heroPreviewBasePosition.copy(heroPreviewRoot.position);

    // Reset flip state
    heroFlipAngle = 0;
    heroFlipTarget = 0;

    fitHeroPreviewCamera();
    startHeroRenderLoop();

    canvasEl.addEventListener("click", onHeroPreviewCanvasClick);
}

function recenterObjectToBounds(object3d) {
    if (!object3d) {
        return;
    }

    const box = new THREE.Box3().setFromObject(object3d);
    if (box.isEmpty()) {
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    object3d.position.sub(center);
}

function onHeroPreviewCanvasClick(event) {
    if (!heroPreviewRenderer || !heroPreviewCamera || !heroPreviewRoot) {
        return;
    }

    const canvasEl = heroPreviewRenderer.domElement;
    const rect = canvasEl.getBoundingClientRect();
    const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, heroPreviewCamera);
    const hits = raycaster.intersectObjects([heroPreviewRoot], true);

    if (hits.length === 0) {
        selectedTagId = null;
        closeHeroCard();
        updateDogTagViewMode();
    } else {
        // Flip the tag to reveal the opposite face
        heroFlipTarget = heroFlipTarget === 0 ? Math.PI : 0;
    }
}

function fitHeroPreviewCamera() {
    if (!heroPreviewRenderer || !heroPreviewCamera || !heroPreviewRoot) {
        return;
    }

    const canvasEl = heroPreviewRenderer.domElement;
    const width = Math.max(1, canvasEl.clientWidth);
    const height = Math.max(1, canvasEl.clientHeight);
    heroPreviewRenderer.setSize(width, height, false);

    heroPreviewCamera.aspect = width / height;
    heroPreviewCamera.updateProjectionMatrix();

    const box = new THREE.Box3().setFromObject(heroPreviewRoot);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.1);
    const fovRad = THREE.MathUtils.degToRad(heroPreviewCamera.fov);
    const fitByHeight = radius / Math.sin(fovRad / 2);
    const portraitPadding = heroPreviewCamera.aspect < 1 ? 1.32 : 1.16;
    const distance = fitByHeight * portraitPadding;

    // Keep camera aligned with the label face normal so the tag does not appear side-on.
    const textCandidate = heroPreviewRoot.children[2];
    const focusObject = textCandidate?.geometry ? textCandidate : heroPreviewRoot.children[1] || heroPreviewRoot;
    const frontNormal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(focusObject.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();

    heroPreviewCamera.position.copy(center).addScaledVector(frontNormal, distance);
    heroPreviewCamera.lookAt(center);
    heroPreviewCamera.updateProjectionMatrix();
}

function renderHeroPreview() {
    if (!heroPreviewRenderer || !heroPreviewScene || !heroPreviewCamera) {
        return;
    }

    heroPreviewRenderer.render(heroPreviewScene, heroPreviewCamera);
}

function resizeHeroPreview() {
    fitHeroPreviewCamera();
    renderHeroPreview();
}

function disposeHeroPreviewRenderer() {
    if (heroFlipRafId !== null) {
        cancelAnimationFrame(heroFlipRafId);
        heroFlipRafId = null;
    }

    const canvasEl = document.getElementById("heroPreviewCanvas");
    if (canvasEl) {
        canvasEl.removeEventListener("click", onHeroPreviewCanvasClick);
    }

    if (heroPreviewScene && heroPreviewRoot) {
        heroPreviewScene.remove(heroPreviewRoot);
    }

    if (heroPreviewRenderer) {
        heroPreviewRenderer.dispose();
    }

    heroPreviewRenderer = null;
    heroPreviewScene = null;
    heroPreviewCamera = null;
    heroPreviewRoot = null;
    heroPreviewBackLabel = null;
    heroPreviewFrontLabels = [];
    heroFlipAngle = 0;
    heroFlipTarget = 0;
    heroPreviewIsQuarterTurn = false;
}

function startHeroRenderLoop() {
    if (heroFlipRafId !== null) {
        cancelAnimationFrame(heroFlipRafId);
    }
    heroFlipRafId = requestAnimationFrame(heroRenderLoop);
}

function heroRenderLoop() {
    if (!heroPreviewRenderer || !heroPreviewScene || !heroPreviewCamera) {
        heroFlipRafId = null;
        return;
    }

    const diff = heroFlipTarget - heroFlipAngle;
    if (Math.abs(diff) > 0.001) {
        heroFlipAngle += diff * 0.18;
    } else {
        heroFlipAngle = heroFlipTarget;
    }

    if (heroPreviewRoot) {
        const flipProgress = THREE.MathUtils.clamp(heroFlipAngle / Math.PI, 0, 1);
        const flipXOffset = heroPreviewIsQuarterTurn ? heroFlipXOffsetQuarterTurn : heroFlipXOffsetFrontFacing;
        heroPreviewCamera.updateMatrixWorld();
        heroPreviewCameraRight.setFromMatrixColumn(heroPreviewCamera.matrixWorld, 0).normalize();
        heroPreviewRoot.position.copy(heroPreviewBasePosition).addScaledVector(heroPreviewCameraRight, flipXOffset * flipProgress);
        heroPreviewRoot.rotation.y = heroFlipAngle;
        const isFlipped = heroFlipAngle > Math.PI / 2;
        for (const fl of heroPreviewFrontLabels) {
            fl.visible = !isFlipped;
        }
        if (heroPreviewBackLabel) {
            heroPreviewBackLabel.visible = isFlipped;
        }
    }

    heroPreviewRenderer.render(heroPreviewScene, heroPreviewCamera);
    heroFlipRafId = requestAnimationFrame(heroRenderLoop);
}

function updateDogTagViewMode() {
    dogTagManager.updateViewMode({
        selectedTagId,
        lodDistance: tagTextLodDistance,
        camera,
    });

    if (removeTagBtn) {
        const hasSelectedTag = selectedTagId !== null && !!dogTagManager.getTagById(selectedTagId);
        removeTagBtn.classList.toggle("hidden", !hasSelectedTag);
    }
}

const setupHeroCardListeners = () => {
    const closeBtn = document.getElementById("closeHeroPreview");
    const overlay = document.getElementById("heroPreviewOverlay");

    if (closeBtn) {
        closeBtn.onclick = () => {
            selectedTagId = null;
            closeHeroCard();
            updateDogTagViewMode();
        };
    }

    if (overlay) {
        overlay.onclick = () => {
            selectedTagId = null;
            closeHeroCard();
            updateDogTagViewMode();
        };
    }
};

setupHeroCardListeners();
setTimeout(setupHeroCardListeners, 100);

document.getElementById("settingsBtn").onclick = () => {
    const isOpen = !document.getElementById("settingsScreen").classList.contains("hidden");
    if (isOpen) {
        closeSettings();
    } else {
        document.getElementById("settingsOverlay").classList.remove("hidden");
        document.getElementById("settingsScreen").classList.remove("hidden");
    }
};

document.getElementById("settingsOverlay").addEventListener("click", closeSettings);

function closeSettings() {
    document.getElementById("settingsOverlay").classList.add("hidden");
    document.getElementById("settingsScreen").classList.add("hidden");
}

function applyUiVisibilityState() {
    document.body.classList.toggle("ui-hidden", isUiHidden);

    if (hideUiBtn) {
        hideUiBtn.textContent = `Hide UI: ${isUiHidden ? "On" : "Off"}`;
        hideUiBtn.setAttribute("aria-pressed", isUiHidden ? "true" : "false");
    }
}

function restoreUiVisibilityPreference() {
    const stored = localStorage.getItem("hideUiEnabled");
    isUiHidden = stored === "1";
    applyUiVisibilityState();
}

document.getElementById("resetChainBtn").onclick = () => {
    for (const link of chainLinks) {
        scene.remove(link);
    }

    dogTagManager.clearAll();

    chainLinks.length = 0;
    selectedTagId = null;
    closeHeroCard();

    chainInteraction.rebuildFromLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    addLink();
    closeSettings();
};

if (hideUiBtn) {
    hideUiBtn.onclick = () => {
        isUiHidden = !isUiHidden;
        localStorage.setItem("hideUiEnabled", isUiHidden ? "1" : "0");
        applyUiVisibilityState();
    };
}

function saveChain() {
    const data = {
        linkCount: chainLinks.length,
        dogTags: dogTagManager.serialize(),
    };

    localStorage.setItem("chainState", JSON.stringify(data));
}

function restoreChain() {
    const raw = localStorage.getItem("chainState");
    if (!raw) {
        return false;
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return false;
    }

    if (!data || typeof data.linkCount !== "number" || data.linkCount < 1) {
        return false;
    }

    isRestoring = true;

    for (let i = 0; i < data.linkCount; i += 1) {
        addLink();
    }

    const restoredTags = [];

    if (Array.isArray(data.dogTags)) {
        for (const t of data.dogTags) {
            if (typeof t?.title === "string" && Number.isInteger(t?.index)) {
                restoredTags.push({ title: dogTagManager.normalizeTitle(t.title), index: t.index, createdAt: t.createdAt || null });
            }
        }
    } else if (Array.isArray(data.echoes)) {
        // Backward compatibility with legacy echo state.
        for (const e of data.echoes) {
            if (typeof e?.title === "string" && Number.isInteger(e?.index)) {
                restoredTags.push({ title: dogTagManager.normalizeTitle(e.title), index: e.index, createdAt: e.createdAt || null });
            }
        }
    }

    for (const entry of restoredTags) {
        if (entry.index < 0 || entry.index >= chainLinks.length) {
            continue;
        }
        dogTagManager.addTagAtIndex(entry.title, entry.index, entry.createdAt || null);
    }

    isRestoring = false;
    updateDogTagViewMode();
    saveChain();
    return true;
}

function animate() {
    requestAnimationFrame(animate);
    chainInteraction.update();
    updateCameraVerticalLimits();
    updateDogTagViewMode();
    renderer.render(scene, camera);
}
