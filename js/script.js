import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js";

let scene;
let camera;
let renderer;
let chainLinks = [];
let linkModel;

const canvas = document.getElementById("chainCanvas");
const statusMessage = document.getElementById("statusMessage");

init();
loadChainLink();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

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

    window.addEventListener("resize", onWindowResize);

    animate();
}

function loadChainLink() {
    const loader = new GLTFLoader();

    loader.load(
        "assets/Chain.glb",
        (gltf) => {
            linkModel = gltf.scene;
            normalizeModel(linkModel);
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

function fitCameraToObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const fitHeightDistance = maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.6;

    camera.position.set(0, 0, distance || 4);
    camera.lookAt(0, 0, 0);
    camera.near = 0.01;
    camera.far = Math.max(100, distance * 10);
    camera.updateProjectionMatrix();
}

function addLink() {
    if (!linkModel) {
        setStatus("Chain model is not ready yet.");
        return;
    }

    const newLink = linkModel.clone(true);
    const offset = chainLinks.length * 0.75;

    newLink.position.y = -offset;
    scene.add(newLink);
    chainLinks.push(newLink);
    setStatus(`Chain links: ${chainLinks.length}`);
}

function removeLink() {
    if (chainLinks.length === 0) {
        return;
    }

    const lastLink = chainLinks.pop();
    scene.remove(lastLink);
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
    renderer.render(scene, camera);
}
