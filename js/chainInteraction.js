import * as THREE from "three";

export class ChainInteraction {
    constructor({ canvas, camera, getChainLinks, getLinkSpacing }) {
        this.canvas = canvas;
        this.camera = camera;
        this.getChainLinks = getChainLinks;
        this.getLinkSpacing = getLinkSpacing;

        this.chainPoints = [];
        this.chainVelocities = [];
        this.bottomAnchor = new THREE.Vector3();

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.dragPoint = new THREE.Vector3();

        this.draggingIndex = -1;
        this.activePointerId = null;
        this.lastDragPosition = new THREE.Vector3();
        this.lastDragTime = 0;

        this.constraintIterations = 8;
        this.motionDamping = 0.94;
        // Positive Y here is intentionally opposite earth gravity for this effect.
        this.gravityStrength = 0.01;

        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
    }

    attach() {
        // Prevent browser touch gestures (scroll/pinch) from stealing chain drag input.
        this.canvas.style.touchAction = "none";
        this.canvas.addEventListener("pointerdown", this.onPointerDown);
        window.addEventListener("pointermove", this.onPointerMove);
        window.addEventListener("pointerup", this.onPointerUp);
        window.addEventListener("pointercancel", this.onPointerUp);
    }

    rebuildFromLinks() {
        const chainLinks = this.getChainLinks();
        this.chainPoints = chainLinks.map((link) => link.position.clone());
        this.chainVelocities = chainLinks.map(() => new THREE.Vector3());

        if (this.chainPoints.length > 0) {
            this.bottomAnchor.copy(this.chainPoints[this.chainPoints.length - 1]);
        }
    }

    isDragging() {
        return this.draggingIndex >= 0;
    }

    update() {
        if (this.chainPoints.length < 2 || this.chainVelocities.length !== this.chainPoints.length) {
            return;
        }

        const previousPoints = this.chainPoints.map((point) => point.clone());
        const lastIndex = this.chainPoints.length - 1;

        for (let i = 0; i < lastIndex; i += 1) {
            if (i === this.draggingIndex) {
                continue;
            }

            this.chainVelocities[i].multiplyScalar(this.motionDamping);
            this.chainVelocities[i].y += this.gravityStrength;
            this.chainPoints[i].add(this.chainVelocities[i]);
            this.chainPoints[i].z = 0;
        }

        this.solveConstraints();

        for (let i = 0; i < lastIndex; i += 1) {
            if (i === this.draggingIndex) {
                continue;
            }

            const frameDelta = new THREE.Vector3().subVectors(this.chainPoints[i], previousPoints[i]);
            this.chainVelocities[i].lerp(frameDelta, 0.4);
        }

        this.chainVelocities[lastIndex].set(0, 0, 0);
        this.applyToLinks();
    }

    setPointerFromEvent(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    findLinkRoot(object) {
        const chainLinks = this.getChainLinks();
        let current = object;

        while (current && !chainLinks.includes(current)) {
            current = current.parent;
        }

        return current;
    }

    onPointerDown(event) {
        if (this.activePointerId !== null) {
            return;
        }

        const chainLinks = this.getChainLinks();

        if (chainLinks.length < 3 || this.chainPoints.length !== chainLinks.length) {
            return;
        }

        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointer, this.camera);

        const intersections = this.raycaster.intersectObjects(chainLinks, true);

        if (intersections.length === 0) {
            return;
        }

        const hitLink = this.findLinkRoot(intersections[0].object);

        if (!hitLink) {
            return;
        }

        const linkIndex = chainLinks.indexOf(hitLink);

        if (linkIndex < 0 || linkIndex >= chainLinks.length - 1) {
            return;
        }

        this.draggingIndex = linkIndex;
        this.activePointerId = event.pointerId;
        this.lastDragTime = performance.now();
        this.lastDragPosition.copy(this.chainPoints[this.draggingIndex]);

        if (event.cancelable) {
            event.preventDefault();
        }

        if (typeof this.canvas.setPointerCapture === "function") {
            try {
                this.canvas.setPointerCapture(event.pointerId);
            } catch {
                // Ignore capture errors and continue dragging when possible.
            }
        }

        this.canvas.style.cursor = "grabbing";
    }

    onPointerMove(event) {
        if (this.draggingIndex < 0) {
            return;
        }

        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
            return;
        }

        const chainLinks = this.getChainLinks();

        if (this.chainPoints.length !== chainLinks.length) {
            return;
        }

        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointer, this.camera);

        if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
            return;
        }

        const clampedDragPoint = this.getClampedDragPoint(this.dragPoint, this.draggingIndex);

        const now = performance.now();
        const dt = Math.max((now - this.lastDragTime) / 1000, 1 / 240);
        const dragVelocity = new THREE.Vector3().subVectors(clampedDragPoint, this.lastDragPosition).multiplyScalar(1 / dt);

        this.chainVelocities[this.draggingIndex].lerp(dragVelocity, 0.35);
        this.lastDragPosition.copy(clampedDragPoint);
        this.lastDragTime = now;

        this.chainPoints[this.draggingIndex].copy(clampedDragPoint);
        this.solveConstraints();
        this.applyToLinks();
    }

    getClampedDragPoint(targetPoint, draggingIndex) {
        const lastIndex = this.chainPoints.length - 1;
        const segmentsToAnchor = lastIndex - draggingIndex;

        if (segmentsToAnchor <= 0) {
            return targetPoint.clone();
        }

        const maxReach = segmentsToAnchor * this.getLinkSpacing();
        const clampedPoint = targetPoint.clone();
        clampedPoint.z = 0;

        const toTarget = new THREE.Vector3().subVectors(clampedPoint, this.bottomAnchor);
        const distance = toTarget.length();

        if (distance > maxReach && distance > 0) {
            toTarget.multiplyScalar(maxReach / distance);
            clampedPoint.copy(this.bottomAnchor).add(toTarget);
        }

        return clampedPoint;
    }

    onPointerUp(event) {
        if (this.activePointerId !== null && event?.pointerId !== this.activePointerId) {
            return;
        }

        if (typeof this.canvas.releasePointerCapture === "function" && this.activePointerId !== null) {
            try {
                this.canvas.releasePointerCapture(this.activePointerId);
            } catch {
                // Ignore capture release errors.
            }
        }

        this.draggingIndex = -1;
        this.activePointerId = null;
        this.canvas.style.cursor = "default";
    }

    solveConstraints() {
        if (this.chainPoints.length < 2) {
            return;
        }

        const linkSpacing = this.getLinkSpacing();
        const lastIndex = this.chainPoints.length - 1;

        for (let iteration = 0; iteration < this.constraintIterations; iteration += 1) {
            this.chainPoints[lastIndex].copy(this.bottomAnchor);

            for (let i = 0; i < lastIndex; i += 1) {
                const p1 = this.chainPoints[i];
                const p2 = this.chainPoints[i + 1];
                const delta = new THREE.Vector3().subVectors(p2, p1);
                const distance = delta.length();

                if (distance === 0) {
                    continue;
                }

                const correction = (distance - linkSpacing) / distance;

                if (i === this.draggingIndex && i + 1 === lastIndex) {
                    continue;
                }

                if (i === this.draggingIndex) {
                    p2.addScaledVector(delta, -correction);
                } else if (i + 1 === this.draggingIndex || i + 1 === lastIndex) {
                    p1.addScaledVector(delta, correction);
                } else {
                    p1.addScaledVector(delta, correction * 0.5);
                    p2.addScaledVector(delta, -correction * 0.5);
                }
            }
        }

        this.chainPoints[lastIndex].copy(this.bottomAnchor);
    }

    applyToLinks() {
        const chainLinks = this.getChainLinks();

        for (let i = 0; i < chainLinks.length; i += 1) {
            const link = chainLinks[i];
            const point = this.chainPoints[i];

            if (!point) {
                continue;
            }

            link.position.copy(point);

            const nextPoint = this.chainPoints[i + 1] || this.chainPoints[i - 1];

            if (nextPoint) {
                const direction = new THREE.Vector3().subVectors(nextPoint, point);

                if (direction.lengthSq() > 0.000001) {
                    const bendAngle = Math.atan2(direction.x, -direction.y);
                    link.rotation.z = bendAngle;
                }
            }

            link.rotation.y = i % 2 === 1 ? Math.PI / 2 : 0;
        }
    }
}
