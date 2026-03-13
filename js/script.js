let scene, camera, renderer;
let chainLinks = [];
let linkModel;

init();
loadChainLink();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.set(0, 1, 5);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("chainCanvas") });
    renderer.setSize(window.innerWidth, window.innerHeight);

    animate();
}

function loadChainLink() {
    const loader = new THREE.GLTFLoader();
    loader.load("assets/chain.glb", (gltf) => {
        linkModel = gltf.scene;
        addLink(); // start with one link
    });
}

function addLink() {
    if (!linkModel) return;

    const newLink = linkModel.clone();
    const offset = chainLinks.length * 0.3;

    newLink.position.y = -offset;

    scene.add(newLink);
    chainLinks.push(newLink);
}

function removeLink() {
    if (chainLinks.length === 0) return;

    const last = chainLinks.pop();
    scene.remove(last);
}

document.getElementById("addLink").onclick = addLink;
document.getElementById("removeLink").onclick = removeLink;

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
