import * as THREE from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

export class DogTagManager {
    constructor({ scene, renderer, getChainLinks, getLinkHalfHeight }) {
        this.scene = scene;
        this.renderer = renderer;
        this.getChainLinks = getChainLinks;
        this.getLinkHalfHeight = getLinkHalfHeight;

        this.tags = [];
        this.nextTagId = 1;
        this.dogTagModel = null;
        this.textFont = null;

        this.metrics = {
            width: 0.4,
            height: 0.7,
            depth: 0.08,
            textSurfaceZ: 0.05,
        };
        // Global text size control for both canvas and 3D dog tag labels.
        // Increase this to make all dog tag text larger.
        this.dogTagFontScale = 4.6;
        this.holeXFactor = -0.5;
        this.holeYFactor = 0.46;
        // local X is depth (forward/back).
        this.holeDepthOffsetX = -3.3;


        // Tune these two profiles independently.
        // quarterTurnProfile affects links whose rotation.y is ~PI/2 (dog tags on the right).
        this.quarterTurnProfile = {
    
            rootLateralFactor: 0.22,

            rootYOffset: 0,
           
            rootZOffset: 1.3,

            // ROOT ROTATION: tilt toward/away.
            rootRotationX: THREE.MathUtils.degToRad(15),
            // ROOT ROTATION: roll/lean.
            rootRotationZ: THREE.MathUtils.degToRad(25),

            // DogTag: left/right on tag face.
            holeXFactor: 0.42,
            // DogTag: up/down on tag face.
            holeYFactor: 0.46,
            // DogTag: forward/back (depth).
            holeDepthOffsetX: -2.16,

            // LABEL CONTROLS (Right Labels):
            // face side (+1 or -1)
            labelFaceSign: 1,
            // Left and Right
            labelSurfaceDepthOffset: -1.6,
            // label visual rotation IMPORTANT
            labelRotY: 4.7,
            // label roll/lean rotation
            labelRollZ: 0,
            // how close it is to the dogtag face
            labelDepthX: 3.6,
            // minimum outward lift to keep text from clipping
            labelTextLiftMin: 0.015,

            // BACK FACE DATE CONTROLS (Right Labels):
            // shift added to frontLabel.position.x
            backLabelXShift: -3.6,
            // shift added to frontLabel.position.y
            backLabelYShift: 0,
            // shift added to (-frontLabel.position.z) to place on back face
            backLabelZShift: 0.35,
            // added to frontLabel.rotation.y to flip to back face
            backLabelRotYShift: Math.PI,
        };





        // frontFacingProfile affects links whose rotation.y is ~0 (dog tags on the left).
        this.frontFacingProfile = {
            // Root horizontal spread from chain link center.
            rootLateralFactor: 0.22,
            // ROOT MOVE: up/down.
            rootYOffset: 0,

            // ROOT MOVE: left/right for front-facing profile.
            // (In attachTagToLink this is intentionally remapped onto root.position.x.)
            rootZOffset: -3,

            // ROOT ROTATION: tilt toward/away.
            rootRotationX: THREE.MathUtils.degToRad(15),
            // ROOT ROTATION: yaw/turn toward camera or away.
            rootRotationY: THREE.MathUtils.degToRad(10) - 1.8,

            // DogTag: left/right on tag face.
            holeXFactor: 0.32,
            // DogTag: up/down on tag face.
            holeYFactor: 0.16,
            // DogTag: forward/back (depth).
            holeDepthOffsetX: -1.3,


            // LABEL CONTROLS (Left Labels):
            // Same control names as quarter-turn so both profiles tune the same way.
            labelFaceSign: -1,
            //(left and right)
            labelSurfaceDepthOffset: -2.2,
            //Rotation toward camera. IMPORTANT to get right for label visibility and aesthetics.
            labelRotY: 7.9,
            //Rotation roll/lean.
            labelRollZ: 0,
            //How close it is to the dogtag face.

            labelDepthX: 0,
            labelTextLiftMin: 0.015,

            // BACK FACE DATE CONTROLS (Left Labels):
            // Front and back
            backLabelXShift: 3.6,
            // up and down
            backLabelYShift: -0.1,
            // Left and right
            backLabelZShift: 0.55,
            // added to frontLabel.rotation.y to flip to back face
            backLabelRotYShift: Math.PI + 0.026,
        };

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.tmpWorld = new THREE.Vector3();
    }

    setAssets({ dogTagModel, textFont }) {
        this.dogTagModel = dogTagModel;
        this.textFont = textFont;
    }

    hasAssets() {
        return !!this.dogTagModel;
    }

    configureDogTagModel(model) {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());

        this.metrics = {
            width: Math.max(0.1, size.x),
            height: Math.max(0.16, size.y),
            depth: Math.max(0.02, size.z),
            textSurfaceZ: Math.max(0.006, size.z * 0.52),
        };
    }

    normalizeTitle(title) {
        const trimmed = (title || "").trim();
        return trimmed.length > 0 ? trimmed : "DOG TAG";
    }

    shiftIndices(delta) {
        for (const tag of this.tags) {
            tag.index += delta;
        }
    }

    prependTag(title, index = 0) {
        if (!this.hasAssets()) {
            return null;
        }

        const record = this.createTagRecord(this.normalizeTitle(title), index);
        this.tags.unshift(record);
        this.refreshAttachments();
        return record;
    }

    addTagAtIndex(title, index, createdAt = null) {
        if (!this.hasAssets()) {
            return null;
        }

        const record = this.createTagRecord(this.normalizeTitle(title), index, createdAt);
        this.tags.push(record);
        this.attachTagToLink(record);
        return record;
    }

    removeAtIndex(index) {
        const removed = this.tags.filter((tag) => tag.index === index);
        for (const tag of removed) {
            this.disposeTag(tag);
        }

        this.tags = this.tags.filter((tag) => tag.index !== index);

        for (const tag of this.tags) {
            if (tag.index > index) {
                tag.index -= 1;
            }
        }

        this.refreshAttachments();
        return removed;
    }

    clearAll() {
        for (const tag of this.tags) {
            this.disposeTag(tag);
        }
        this.tags.length = 0;
    }

    getTagById(id) {
        return this.tags.find((tag) => tag.id === id) || null;
    }

    removeTagById(id) {
        const tag = this.getTagById(id);
        if (!tag) {
            return null;
        }

        const removedIndex = tag.index;
        this.disposeTag(tag);
        this.tags = this.tags.filter((entry) => entry.id !== id);

        for (const entry of this.tags) {
            if (entry.index > removedIndex) {
                entry.index -= 1;
            }
        }

        this.refreshAttachments();
        return tag;
    }

    pickTagFromEvent(event, canvas, camera) {
        if (this.tags.length === 0) {
            return null;
        }

        const rect = canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, camera);
        const roots = this.tags.map((tag) => tag.root);
        const intersections = this.raycaster.intersectObjects(roots, true);

        if (intersections.length === 0) {
            return null;
        }

        return this.findTagFromObject(intersections[0].object);
    }

    updateViewMode({ selectedTagId, lodDistance, camera }) {
        for (const tag of this.tags) {
            if (tag.textMesh) {
                tag.textMesh.visible = true;
            }

            if (tag.canvasMesh) {
                tag.canvasMesh.visible = false;
            }
        }
    }

    serialize() {
        return this.tags.map(({ title, index, createdAt }) => ({ title, index, createdAt }));
    }

    refreshAttachments() {
        for (const tag of this.tags) {
            this.attachTagToLink(tag);
        }
    }

    createTagRecord(title, index, createdAt = null) {
        const id = this.nextTagId;
        this.nextTagId += 1;

        const root = new THREE.Group();
        root.name = `DogTag_${id}`;
        root.userData.tagId = id;

        const body = this.dogTagModel.clone(true);
        body.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = true;
                child.userData.tagId = id;
            }
        });
        root.add(body);

        const canvasTexture = this.createTagCanvasTexture(title);
        const canvasMaterial = new THREE.MeshBasicMaterial({ map: canvasTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const canvasGeometry = new THREE.PlaneGeometry(this.metrics.width * 0.82, this.metrics.height * 0.5);
        const canvasMesh = new THREE.Mesh(canvasGeometry, canvasMaterial);
        canvasMesh.userData.tagId = id;
        root.add(canvasMesh);

        const textMesh = this.createTagTextMesh(title);
        textMesh.userData.tagId = id;
        textMesh.visible = false;
        root.add(textMesh);

        const side = index % 2 === 0 ? 1 : -1;
        root.position.set(side * (this.getLinkHalfHeight() + this.metrics.width * 0.22), 0, 0);
        root.rotation.y = side === 1 ? -0.25 : 0.25;

        return {
            id,
            title,
            index,
            side,
            root,
            body,
            canvasMesh,
            canvasMaterial,
            canvasTexture,
            textMesh,
            createdAt: createdAt ?? new Date().toISOString(),
        };
    }

    attachTagToLink(tag) {
        const chainLinks = this.getChainLinks();
        const link = chainLinks[tag.index];
        if (!link) {
            return;
        }

        if (tag.root.parent !== link) {
            link.add(tag.root);
        }

        const normalizedY = Math.abs(link.rotation.y % Math.PI);
        const isQuarterTurn = Math.abs(normalizedY - Math.PI / 2) < 0.001;
        const profile = isQuarterTurn ? this.quarterTurnProfile : this.frontFacingProfile;

        tag.side = tag.index % 2 === 0 ? 1 : -1;

        const baseLateralX = tag.side * (this.getLinkHalfHeight() + this.metrics.width * profile.rootLateralFactor);
        tag.root.position.x = isQuarterTurn ? baseLateralX : baseLateralX + profile.rootZOffset;
        tag.root.position.y = profile.rootYOffset;
        tag.root.position.z = isQuarterTurn ? profile.rootZOffset : 0;

        // Root rotation controls:
        // - rootRotationX/rootRotationY/rootRotationZ (per profile).
        tag.root.rotation.x = profile.rootRotationX;
        tag.root.rotation.y = profile.rootRotationY ?? 0;
        tag.root.rotation.z = profile.rootRotationZ ?? 0;

        tag.isQuarterTurn = isQuarterTurn;

        const holeX = this.metrics.width * profile.holeXFactor;
        const holeY = -this.metrics.height * profile.holeYFactor;
        const depthX = profile.holeDepthOffsetX;

        // Label-only controls come from the active profile.
        // Both profiles expose the same fields: labelFaceSign, labelSurfaceDepthOffset,
        // labelRotY, labelRollZ, labelDepthX, labelTextLiftMin.
        const labelFaceSign = profile.labelFaceSign ?? (isQuarterTurn ? 1 : -1);
        const labelSurfaceDepth = this.metrics.textSurfaceZ + (profile.labelSurfaceDepthOffset ?? 0.001);
        const labelRotY = profile.labelRotY ?? (isQuarterTurn ? Math.PI / 2 : Math.PI);
        const labelRollZ = profile.labelRollZ ?? 6;
        const labelTextLift = Math.max(profile.labelTextLiftMin ?? 0.01, this.metrics.depth * 0.08);
        // Keep placement stable in local Z so changing labelRotY does not move labels.
        const labelDepthX = profile.labelDepthX ?? 0;
        const labelDepthZ = labelFaceSign * labelSurfaceDepth;
        const labelNormalX = Math.sin(labelRotY) * labelFaceSign;
        const labelNormalZ = Math.cos(labelRotY) * labelFaceSign;
        const textExtrudeDepth = tag.textMesh.userData?.extrudeDepth ?? 0;
        const textNormalLift = labelTextLift + textExtrudeDepth * 0.5;

        tag.body.position.set(holeX + depthX, holeY, 0);

        // Canvas and text are root children. Depth is applied along label normal,
        // so changing labelSurfaceDepth always moves through the face.
        tag.canvasMesh.position.set(holeX + depthX + labelDepthX, holeY, labelDepthZ);
        tag.canvasMesh.rotation.set(0, labelRotY, labelRollZ);

        tag.textMesh.position.set(
            holeX + depthX + labelDepthX + tag.textMesh.userData.baseX + labelNormalX * textNormalLift,
            holeY + tag.textMesh.userData.baseY,
            labelDepthZ + labelNormalZ * textNormalLift
        );
        tag.textMesh.rotation.set(0, labelRotY, labelRollZ);

    }

    createTagCanvasTexture(title) {
        const canvasElement = document.createElement("canvas");
        canvasElement.width = 1024;
        canvasElement.height = 512;
        const textScale = this.dogTagFontScale ?? 1;

        const ctx = canvasElement.getContext("2d");
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.fillStyle = "rgba(245,245,245,0.94)";
        ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(40,40,40,0.65)";
        ctx.strokeRect(8, 8, canvasElement.width - 16, canvasElement.height - 16);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#111111";

        const lines = this.wrapTitleToTwoLines(title);
        const maxTextWidth = canvasElement.width * 0.88;
        const maxTextHeight = canvasElement.height * 0.72;

        let fontSize = 180 * textScale;
        while (fontSize > 36 * textScale) {
            ctx.font = `700 ${fontSize}px "courier-new", sans-serif`;
            const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
            const lineHeight = fontSize * 1.02;
            const blockHeight = lineHeight * lines.length;

            if (widest <= maxTextWidth && blockHeight <= maxTextHeight) {
                break;
            }

            fontSize -= 2;
        }

        ctx.font = `700 ${fontSize}px "courier-new", sans-serif`;
        const lineHeight = fontSize * 1.02;
        const blockHeight = lineHeight * lines.length;
        let y = canvasElement.height / 2 - blockHeight / 2 + lineHeight / 2;

        for (const line of lines) {
            ctx.fillText(line, canvasElement.width / 2, y);
            y += lineHeight;
        }

        const texture = new THREE.CanvasTexture(canvasElement);
        texture.needsUpdate = true;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createTagTextMesh(title) {
        if (!this.textFont) {
            const placeholder = new THREE.Group();
            placeholder.userData.baseX = 0;
            placeholder.userData.baseY = 0;
            placeholder.userData.baseZ = this.metrics.textSurfaceZ + 0.0022;
            placeholder.userData.extrudeDepth = 0;
            return placeholder;
        }

        //if you want to change the font size, change this.dogTagFontScale (at the top) which applies to both canvas and 3D text for consistent sizing.
        const textScale = this.dogTagFontScale ?? 1;
        const lines = this.wrapTitleToTwoLines(title);
        const widthTarget = this.metrics.width * 0.8;
        const heightTarget = this.metrics.height * 0.45;

        // Measure at size=1 so we can choose one shared size that fits both lines.
        const probes = lines.map((line) => {
            const g = new TextGeometry(line, {
                font: this.textFont,
                size: 1,
                height: 0.25,
                curveSegments: 6,
                bevelEnabled: false,
            });
            g.computeBoundingBox();
            const b = g.boundingBox;
            const width = b.max.x - b.min.x;
            const height = b.max.y - b.min.y;
            g.dispose();
            return { line, width, height };
        });

        const maxUnitWidth = Math.max(0.0001, ...probes.map((p) => p.width));
        const maxUnitHeight = Math.max(0.0001, ...probes.map((p) => p.height));
        const unitGap = maxUnitHeight * 0.28;
        const unitBlockHeight = probes.reduce((sum, p) => sum + p.height, 0) + unitGap * (probes.length - 1);

        const fitByWidth = widthTarget / maxUnitWidth;
        const fitByHeight = heightTarget / unitBlockHeight;
        const size = Math.max(0.045 * textScale, Math.min(fitByWidth, fitByHeight, 0.2 * textScale));
        const extrudeDepth = size * 0.24;
        const lineGap = size * 0.28;
        const baseZ = this.metrics.textSurfaceZ + 0.0022;

        const lineGeometries = probes.map((p) => {
            const g = new TextGeometry(p.line, {
                font: this.textFont,
                size,
                height: extrudeDepth,
                curveSegments: 8,
                bevelEnabled: true,
                bevelThickness: size * 0.05,
                bevelSize: size * 0.03,
                bevelSegments: 2,
            });
            g.computeBoundingBox();
            return g;
        });

        const lineHeights = lineGeometries.map((g) => g.boundingBox.max.y - g.boundingBox.min.y);
        const blockHeight = lineHeights.reduce((sum, h) => sum + h, 0) + lineGap * (lineGeometries.length - 1);
        let cursorTop = blockHeight / 2;

        for (let i = 0; i < lineGeometries.length; i += 1) {
            const g = lineGeometries[i];
            const box = g.boundingBox;
            const width = box.max.x - box.min.x;
            const height = box.max.y - box.min.y;
            const centerX = -(box.min.x + width / 2);
            const targetY = cursorTop - height / 2;
            const centerY = -(box.min.y + height / 2) + targetY;
            g.translate(centerX, centerY, baseZ);
            cursorTop -= height + lineGap;
        }

        const geometry = BufferGeometryUtils.mergeGeometries(lineGeometries, false);
        for (const g of lineGeometries) {
            g.dispose();
        }

        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
                color: 0x161616,
                metalness: 0.6,
                roughness: 0.45,
                side: THREE.DoubleSide,
            })
        );

        mesh.userData.baseX = 0;
        mesh.userData.baseY = 0;
        mesh.userData.baseZ = baseZ;
        mesh.userData.extrudeDepth = extrudeDepth;
        mesh.position.set(0, 0, 0);
        return mesh;
    }

    createHeroBackDateMesh(dateStr, frontLabel, isQuarterTurn = true) {
        if (!this.textFont) {
            return new THREE.Group();
        }

        const date = dateStr ? new Date(dateStr) : new Date();
        const formatted = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        const lines = ["CREATED", formatted];

        const widthTarget = this.metrics.width * 0.8;
        const heightTarget = this.metrics.height * 0.45;
        const textScale = this.dogTagFontScale ?? 1;
        const baseZ = this.metrics.textSurfaceZ + 0.0022;

        const probes = lines.map((line) => {
            const g = new TextGeometry(line, { font: this.textFont, size: 1, height: 0.25, curveSegments: 6, bevelEnabled: false });
            g.computeBoundingBox();
            const b = g.boundingBox;
            const w = b.max.x - b.min.x;
            const h = b.max.y - b.min.y;
            g.dispose();
            return { line, width: w, height: h };
        });

        const maxUnitWidth = Math.max(0.0001, ...probes.map((p) => p.width));
        const maxUnitHeight = Math.max(0.0001, ...probes.map((p) => p.height));
        const unitGap = maxUnitHeight * 0.28;
        const unitBlockHeight = probes.reduce((sum, p) => sum + p.height, 0) + unitGap * (probes.length - 1);

        const fitByWidth = widthTarget / maxUnitWidth;
        const fitByHeight = heightTarget / unitBlockHeight;
        const size = Math.max(0.045 * textScale, Math.min(fitByWidth, fitByHeight, 0.2 * textScale));
        const extrudeDepth = size * 0.24;
        const lineGap = size * 0.28;

        const lineGeometries = probes.map((p) => {
            const g = new TextGeometry(p.line, {
                font: this.textFont, size, height: extrudeDepth,
                curveSegments: 8, bevelEnabled: true,
                bevelThickness: size * 0.05, bevelSize: size * 0.03, bevelSegments: 2,
            });
            g.computeBoundingBox();
            return g;
        });

        const lineHeights = lineGeometries.map((g) => g.boundingBox.max.y - g.boundingBox.min.y);
        const blockHeight = lineHeights.reduce((sum, h) => sum + h, 0) + lineGap * (lineGeometries.length - 1);
        let cursorTop = blockHeight / 2;

        for (let i = 0; i < lineGeometries.length; i += 1) {
            const g = lineGeometries[i];
            const box = g.boundingBox;
            const w = box.max.x - box.min.x;
            const h = box.max.y - box.min.y;
            const centerX = -(box.min.x + w / 2);
            const targetY = cursorTop - h / 2;
            const centerY = -(box.min.y + h / 2) + targetY;
            g.translate(centerX, centerY, baseZ);
            cursorTop -= h + lineGap;
        }

        const geometry = BufferGeometryUtils.mergeGeometries(lineGeometries, false);
        for (const g of lineGeometries) { g.dispose(); }

        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0x161616, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide })
        );
        mesh.userData.isBackFace = true;
        mesh.userData.extrudeDepth = extrudeDepth;

        if (frontLabel) {
            // ── BACK-FACE DATE PLACEMENT ──────────────────────────────────────────
            // Uses per-profile back label controls so left and right tags can be
            // tuned independently. Adjust backLabel* values in each profile.
            const backProfile = isQuarterTurn ? this.quarterTurnProfile : this.frontFacingProfile;
            const xShift = backProfile.backLabelXShift ?? -3.6;
            const yShift = backProfile.backLabelYShift ?? 0;
            const zShift = backProfile.backLabelZShift ?? 0.35;
            const rotYShift = backProfile.backLabelRotYShift ?? Math.PI;
            mesh.position.set(
                frontLabel.position.x + xShift,
                frontLabel.position.y + yShift,
                -frontLabel.position.z + zShift
            );
            mesh.rotation.set(
                frontLabel.rotation.x,
                frontLabel.rotation.y + rotYShift,
                frontLabel.rotation.z
            );
        }


        return mesh;
    }

    normalizeTitleForWrap(title) {
        const clean = (title || "").trim().replace(/\s+/g, " ");
        const capped = clean.slice(0, 40);
        return capped.length > 0 ? capped : "DOG TAG";
    }

    wrapTitleToTwoLines(title) {
        const cleanTitle = this.normalizeTitleForWrap(title);

        if (cleanTitle.length <= 12) {
            return [cleanTitle];
        }

        const midpoint = Math.floor(cleanTitle.length / 2);
        const leftSpace = cleanTitle.lastIndexOf(" ", midpoint);
        const rightSpace = cleanTitle.indexOf(" ", midpoint);

        let split = -1;
        if (leftSpace === -1 && rightSpace === -1) {
            split = midpoint;
        } else if (leftSpace === -1) {
            split = rightSpace
        } else if (rightSpace === -1) {
            split = leftSpace;
        } else {
            split = midpoint - leftSpace <= rightSpace - midpoint ? leftSpace : rightSpace;
        }

        const line1 = cleanTitle.slice(0, split).trim();
        const line2 = cleanTitle.slice(split).trim();
        return line2.length > 0 ? [line1, line2] : [line1];
    }

    findTagFromObject(object) {
        let current = object;

        while (current) {
            if (current.userData?.tagId) {
                return this.getTagById(current.userData.tagId);
            }
            current = current.parent;
        }

        return null;
    }

    disposeTag(tag) {
        if (tag.root.parent) {
            tag.root.parent.remove(tag.root);
        }

        if (tag.canvasMesh?.geometry) {
            tag.canvasMesh.geometry.dispose();
        }

        if (tag.canvasMaterial) {
            tag.canvasMaterial.dispose();
        }

        if (tag.canvasTexture) {
            tag.canvasTexture.dispose();
        }

        if (tag.textMesh?.geometry) {
            tag.textMesh.geometry.dispose();
        }

        if (tag.textMesh?.material) {
            tag.textMesh.material.dispose();
        }
    }
}
