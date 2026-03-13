import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ChainInteraction } from "./chainInteraction.js";

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

const scrollSensitivity = 0.01;

const canvas = document.getElementById("chainCanvas");
const statusMessage = document.getElementById("statusMessage");
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
        return;
    }

    const chainHeight = (chainLinks.length - 1) * linkSpacing + linkHalfHeight * 2;
    const fitAll = (chainHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    zoomMaxZ = Math.max(fitAll * 1.2, zoomMinZ);
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

function removeLink() {
    if (chainLinks.length === 0) {
        return;
    }

    const lastLink = chainLinks.pop();
    scene.remove(lastLink);
    chainInteraction.rebuildFromLinks();
    chainInteraction.applyToLinks();
    updateZoomLimits();
    updateCameraVerticalLimits();
    setStatus(`Chain links: ${chainLinks.length}`);
}

function setStatus(message) {
    statusMessage.textContent = message;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

document.getElementById("addLink").onclick = addLink;
document.getElementById("removeLink").onclick = removeLink;

function animate() {
    requestAnimationFrame(animate);
    chainInteraction.update();
    renderer.render(scene, camera);
}
