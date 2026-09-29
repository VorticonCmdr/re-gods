# **Technical Implementation Specification for Replicating Gods in HTML5/JavaScript**

Porting the 1991 Bitmap Brothers platform game *Gods* from its original Motorola 68000 assembly runtime (developed for the Amiga, Atari ST, and MS-DOS) to an HTML5 and JavaScript browser architecture requires reverse engineering proprietary binary asset structures, replicating deterministic state machines, and constructing a responsive, pixel-accurate rendering and audio engine1. The original title relies on strict frame-synchronized logic execution, bespoke file compression, planar graphic bitplane arrangements, an adaptive artificial intelligence system, and complex spatial puzzle trigger engines1. Modernizing this codebase while retaining true parity requires replicating these mechanisms at the byte and frame levels1.

## **Binary Asset Formats, Decompression, and Graphic Pipeline Conversion**

The visual and level assets of *Gods* are packed inside binary archives designed to minimize floppy disk access times and fit within strict 16-bit system RAM constraints3. Rebuilding these assets within a browser runtime requires byte-level parsers capable of unpacking compressed archives, extracting interleaved planar bitplane graphics, and reconstructing complex level tilemap arrays3.

### **Rob Northen Compression Parsing**

The overwhelming majority of data files within *Gods* are compressed using Rob Northen Compression Method 1 (RNC1 / Propack)3. The RNC1 format is an LZ77 dictionary-based compression variant combined with dynamic bit-level Huffman coding operating on big-endian byte streams6.  
An RNC1 file begins with a strict 18-byte structured header that must be validated before decompression6.

| Byte Offset | Field Type | Byte Order | Specification and Description |
| :---- | :---- | :---- | :---- |
| 0x00 \- 0x03 | 4-byte ASCII | Big-Endian | Compression Signature (RNC\\x01 / 0x524E4301)6 |
| 0x04 \- 0x07 | 32-bit UInt | Big-Endian | Uncompressed payload size in bytes6 |
| 0x08 \- 0x0B | 32-bit UInt | Big-Endian | Compressed payload size in bytes6 |
| 0x0C | 8-bit UInt | Native | Count of uncompressed blocks in stream6 |
| 0x0D | 8-bit UInt | Native | Packaging structure format flags6 |
| 0x0E \- 0x11 | 32-bit UInt | Big-Endian | CRC-16 or CRC-32 checksum of uncompressed stream6 |

In a modern browser implementation, compressed raw binary buffers fetched via the Fetch API as ArrayBuffer objects are parsed using JavaScript DataView instances. The RNC1 bitstream is read from right to left (low bit to high bit). Bit-window pointers process literal byte runs or dictionary lookbacks based on Huffman code tables evaluated at runtime. The decompressed output is stored directly in a Uint8Array before being passed to graphic and map parsers.

### **Planar Graphics and Bitplane Conversion**

Graphics in *Gods* originate from an Atari ST baseline and Amiga planar bitplane architecture3. Graphic assets are stored as raw, interleaved 4-bitplane planar images3. In this structure, four separate bitplanes combine to form a 16-color palette index for every pixel4.  
The asset dumps reveal an additional 5th bitplane embedded within the graphic buffers3. Rather than functioning as a hardware Extra-Halfbrite (EHB) 32-color expansion bit, this 5th bitplane serves as a dedicated binary collision mask for pixel-exact surface checking3. A bit value of 1 in this 5th plane denotes a solid pixel, while 0 represents passable air3.  
Tiles in *Gods* are uniformly formatted as ![][image1] pixel blocks7. In memory, each tile row spans 2 bytes (16 bits) per bitplane7. Converting these 4-bitplane tiles into standard 32-bit RGBA HTML5 ImageData objects requires iterating through every row and bit position:  
![][image2]  
Where ![][image3] represents the 16-bit word of bitplane ![][image4] at vertical row ![][image5], and ![][image6] represents the horizontal pixel offset from 0 to 15\. The resulting 4-bit color index maps directly into a 16-entry RGBA color array extracted from the level's palette header3. The parsed RGBA values populate a Uint8ClampedArray to create WebGL texture atlases or CanvasImageData buffers.

### **Level Tilemap Binary Structures**

Every level stage in *Gods* is structured around a canvas grid measuring ![][image7] pixels7. Divided into uniform ![][image1] pixel tiles, a complete map matrix comprises exactly 256 horizontal columns by 64 vertical rows, yielding 16,384 discrete tile cell entries7.  
The map binary file (such as LEV1BAK.BIN) contains an initial configuration header followed by a contiguous array of 16-bit cell records7.

| Header Offset | Data Type | Field Purpose and Data Interpretation |
| :---- | :---- | :---- |
| 0x00 \- 0x3F | Byte Array | Palette setup, background tinting, and level metadata8 |
| 0x40 \- 0x41 | 16-bit UInt (BE) | Map tile width value (standard ![][image8] tiles)8 |
| 0x42 \- 0x43 | 16-bit UInt (BE) | Map tile height value (standard ![][image9] tiles)8 |
| 0x44 \- 0x45 | 16-bit UInt (BE) | Maximum unique tile index limit (![][image10] / 512 max tiles)8 |
| 0x46 \- End | 16-bit Word Array | Consecutive map cell entries (![][image11] total words)8 |

Each 16-bit tile cell word is unpacked using bitwise bitmask operations8:

* **Bits 0–8 (Mask 0x01FF)**: Tile Visual ID index mapping to the pre-rendered ![][image1] tile atlas8.  
* **Bits 9–12 (Mask 0x1E00)**: Altitude, Z-ordering, and depth layering properties for foreground and background tile rendering8.  
* **Bits 13–15 (Mask 0xE000)**: Special surface attributes, including ladder flags, water properties, destructibility, and hazardous spike behaviors8.

## **Artificial Intelligence Framework and Adaptive Difficulty Subsystem**

The gameplay engine of *Gods* features a dynamic behavioral engine5. Rather than relying strictly on scripted path loops, the game dynamically monitors player proficiency, alters health pools on the fly, and manages thief entities that interact directly with inaccessible items4.

### **Dynamic Adaptive Difficulty Subsystem**

The adaptive balancing system continuously tracks player performance metrics across active sub-levels4. Key tracking variables include current player health percentages, cumulative weapon power values, elapsed sub-level duration, total deaths/continues used, and current key item capacity4.  
A balance evaluation function executes at regular intervals (typically once every 50 tick cycles, or 1 second) to compute an operational difficulty index1:  
![][image12]  
When the calculated scale drops below designated baseline thresholds—indicating the player is struggling, taking excessive damage, or lacking offensive upgrades—the adaptive engine executes compensatory interventions4:

* **Hit-Point Adjustment**: Attaching extra damage tolerance to the hero or dynamically reducing the maximum health pool of newly spawned monsters4.  
* **Help Bonus Spawning**: Activating conditional spatial triggers that drop explicit "Help" potions, invincibility stars, or bonus weapons into reachable map coordinates4.  
* **Aggression Suppression**: Decreasing enemy projectile firing frequencies and widening pathfinding tracking tolerance angles to make airborne enemies less relentless.

Conversely, if the player clears rooms quickly without taking damage while possessing maximum weapon power, the adaptive system awards "Speed Bonuses," elevates monster health pools, and spawns optional elite waves4.

### **Thief Entity State Machine Mechanics**

Thief entities represent a distinct class of actor engineered to force tactical urgency by robbing players of unreachable or puzzle-locked treasures5.  
A thief operates under a strict state machine:

> 1. **Spawning Phase**: The thief activates when the hero enters a room boundary housing a thief-designated item5. The entity emerges directly from a designated background wall passage tile5.  
> 2. **Target Navigation**: The thief calculates a platform-bound path moving directly toward the target item's spatial coordinates5.  
> 3. **Item Acquisition**: Upon colliding with the item's bounding box, the thief sets the item's visibility flag to false and attaches the item's unique ID to its internal structure5.  
> 4. **Retreat Execution**: The thief flips its horizontal facing direction and navigates toward a secondary exit passage tile elsewhere in the room5.  
> 5. **Resolution Mechanics**: If the player destroys the thief while it is in transit, the entity's drop callback fires, dropping the item onto the floor tile where the thief died5. If the thief reaches the exit passage, the attached item ID is purged from the level data entirely, making the item permanently unobtainable5.

### **General Entity Spatial Processing and Pathfinding**

To conserve processing overhead on legacy hardware, entity AI logic is updated based on vertical spatial boundaries4. Given the hero's current vertical map position ![][image13] and a standard display screen height ![][image14] of 200 pixels, active AI ticks process only those entities positioned within a controlled vertical window4:  
![][image15]  
Entities outside this spatial band remain completely paused in memory4.  
AI navigation relies on two fundamental movement profiles2:

* **Ground Walkers**: Enemies check platform boundaries by executing short-range lookahead tile probes2. If an edge or wall is detected, the enemy either reverses direction or executes a jump if a target platform is within vertical reach5.  
* **Aerial Tracking Flyers**: Flying units calculate continuous directional vectors pointing toward the hero's center bounding coordinate2. Flight paths combine smooth sine-wave vertical oscillations with ray-cast platform avoidance checks to prevent clipping through solid geometry2.

## **Puzzle State Logic, Spatial Triggers, and Inventory Economics**

Level progression within *Gods* is tied to environmental puzzles governed by lever configuration matrices, spatial trigger regions, and inventory management rules5.

### **Lever Permutation Engines**

Interactive levers exist in two primary states: Up (U) and Down (D)14. Puzzles featuring multi-lever banks store state configurations within integer bitfields14. The game evaluates these bitfields against solution matrices whenever a lever state toggles14.

| Lever Configuration Pattern | Binary Bitmask | Environmental Event Triggered |
| :---- | :---- | :---- |
| U-U-D | 0b001 | Spawns a monster wave; final monster drops a high-value gem14. |
| U-D-U | 0b010 | Disables an active floor-dart trap in an adjacent corridor14. |
| D-U-U | 0b100 | Spawns an aggressive monster wave; yields a low-value gem reward14. |
| U-D-D | 0b011 | Spawns a treasure chest containing a main progression key14. |
| D-U-D | 0b101 | Drops a secret gold gem (requires prior execution of U-D-D)14. |

### **Spatial Trigger Evaluation Engine**

Triggers are invisible bounding regions embedded throughout the level map grid2. When the hero's bounding box intersects a trigger coordinate, the engine evaluates conditional criteria14:

JavaScript  
function evaluateTriggerNode(triggerNode, playerState) {  
    if (\!triggerNode.active) return;

    const isIntersecting \= checkAABBOverlap(playerState.bounds, triggerNode.bounds);  
    if (\!isIntersecting) return;

    let conditionsSatisfied \= true;

    if (triggerNode.requiredHealth && playerState.health \< triggerNode.requiredHealth) {  
        conditionsSatisfied \= false;  
    }  
    if (triggerNode.requiredScore && playerState.score \< triggerNode.requiredScore) {  
        conditionsSatisfied \= false;  
    }  
    if (triggerNode.maxTimeLimit && playerState.levelTime \> triggerNode.maxTimeLimit) {  
        conditionsSatisfied \= false;  
    }  
    if (triggerNode.requiredItem && \!playerState.inventory.includes(triggerNode.requiredItem)) {  
        conditionsSatisfied \= false;  
    }

    if (conditionsSatisfied) {  
        executeTriggerAction(triggerNode.actionPayload);  
        if (triggerNode.isOneShot) {  
            triggerNode.active \= false;  
        }  
    }  
}

### **Inventory Dynamics and Shop Economics**

The player's inventory container is strictly restricted to four item slots5.  
Item interactions follow concrete operational rules:

* **Slot Swapping**: Attempting to collect a fifth item when inventory is full forces an immediate swap with the currently highlighted item slot, dropping the existing item onto the floor5.  
* **Automatic Consumption**: Quest items, including pots, keys, and teleporter artifacts, are automatically consumed when the hero steps into corresponding puzzle trigger regions5.  
* **Inter-Level Trader System**: Upon clearing sub-levels, accumulated wealth (gold cups, diamonds, and treasure chests) is converted into shop currency5. The shop system presents tiered upgrade categories, including weapons (Daggers, Maces, Spears, Firebombs, Bouncing Axes), offensive familiars, invincibility shields, health potions, and arc modifiers (wide-spread, focused, or rear-firing weapons)5.

## **Physical Kinematics and Dual-Layer Collision Architecture**

The movement physics in *Gods* rely on frame-locked, deterministic grid rules rather than continuous floating-point impulse solvers1.

### **Hero Kinematics and Movement Trajectories**

Hero movement is strictly tied to 50 Hz frame ticks1. Horizontal movement uses fixed integer byte-per-frame offsets without acceleration smoothing:

* **Horizontal Walk Speed**: ![][image16].  
* **Vertical Ladder Climb Speed**: ![][image17] (active when overlapping ladder tiles)4.  
* **Initial Jump Impulse**: ![][image18].  
* **Gravity Acceleration**: ![][image19].

Jump arcs in *Gods* are fully committed trajectories5. Once airborne, ![][image20] cannot be altered mid-air by directional inputs unless the character sustains damage or collides with solid vertical walls18.

JavaScript  
// Discrete 50Hz airborne physics calculation step  
function updateAirborneKinematics(hero) {  
    hero.y \+= hero.vy;  
    hero.vy \+= 0.4; // Apply constant gravity step  
      
    // Terminal velocity clamp  
    if (hero.vy \> 6.5) {  
        hero.vy \= 6.5;  
    }

    hero.x \+= hero.vx; // Horizontal velocity remains locked from jump frame  
}

When climbing ladders, horizontal movement locks to the exact center axis of the ladder tile4:  
![][image21]  
This snap alignment prevents positional drift and ensures clean vertical climbing transitions.

### **Dual-Layer Collision Engine**

Collision detection is executed across two distinct phases:

> 1. **Broadphase Tile-Map Collision**: The entity's axis-aligned bounding box (AABB) is mapped to map tile indices13:

![][image22]  
Tiles carry bitwise metadata flags denoting solid ground, one-way platforms, ladder axes, and hazard zones13.

> 1. **Narrowphase Bitplane Pixel Collision**: For sloped surfaces, decorative arches, and non-rectangular terrain, the engine performs pixel-exact masks using the extracted 5th bitplane3.

JavaScript  
function checkPixelExactCollision(entityBounds, bitplaneMaskAtlas) {  
    const left \= Math.floor(entityBounds.left);  
    const right \= Math.ceil(entityBounds.right);  
    const top \= Math.floor(entityBounds.top);  
    const bottom \= Math.ceil(entityBounds.bottom);

    for (let py \= top; py \< bottom; py++) {  
        for (let px \= left; px \< right; px++) {  
            if (bitplaneMaskAtlas.getBitMaskValue(px, py) \=== 1) {  
                return true; // Overlapping a solid bitplane pixel  
            }  
        }  
    }  
    return false;  
}

## **HTML5/JavaScript Engine Implementation**

To maintain exact behavioral parity with the original 68000 assembly runtime, the browser framework must enforce fixed time-step loops, crisp pixel rendering, and chip-accurate audio synthesis1.

### **Deterministic Frame Loop and Pseudo-Random Number Generation**

To prevent high-refresh-rate displays (120 Hz, 144 Hz) from altering game speed, input processing, physics, and AI updates must be bound to a fixed 50 Hz tick accumulator (![][image23] per step) using requestAnimationFrame1.  
The original game relies on deterministic pseudo-random number generator (PRNG) seeds rather than clock-based random values1. Using a Linear Congruential Generator (LCG) mirroring the original machine algorithm ensures identical frame-by-frame enemy spawn behaviors:

JavaScript  
class EngineRuntime {  
    constructor() {  
        this.targetFps \= 50;  
        this.stepSize \= 1000 / this.targetFps; // Exactly 20.0ms  
        this.accumulator \= 0;  
        this.lastTime \= performance.now();  
        this.rngSeed \= 0x12345678; // Fixed initial seed  
    }

    // Deterministic 32-bit Linear Congruential Generator  
    stepRandom() {  
        this.rngSeed \= (Math.imul(1103515245, this.rngSeed) \+ 12345) & 0x7FFFFFFF;  
        return this.rngSeed;  
    }

    runLoop(currentTime) {  
        const deltaTime \= currentTime \- this.lastTime;  
        this.lastTime \= currentTime;  
        this.accumulator \+= Math.min(deltaTime, 250); // Prevent spiral of death

        while (this.accumulator \>= this.stepSize) {  
            this.pollInputs();  
            this.updatePhysicsAndAI(); // Executes fixed 50Hz logic step  
            this.accumulator \-= this.stepSize;  
        }

        this.renderFrame(this.accumulator / this.stepSize);  
        requestAnimationFrame((time) \=\> this.runLoop(time));  
    }  
}

### **Canvas Rendering Pipeline**

The internal target display resolution is fixed at ![][image24] pixels (PAL display format) scaled up using nearest-neighbor scaling (image-rendering: pixelated). Rendering utilizes an offscreen OffscreenCanvas rendered across five distinct layers:

JavaScript  
class CompositingRenderer {  
    constructor() {  
        this.displayCanvas \= document.getElementById('gameCanvas');  
        this.displayCtx \= this.displayCanvas.getContext('2d', { alpha: false });  
        this.offscreen \= new OffscreenCanvas(320, 200);  
        this.ctx \= this.offscreen.getContext('2d');

        this.displayCtx.imageSmoothingEnabled \= false;  
        this.ctx.imageSmoothingEnabled \= false;  
    }

    render(gameState) {  
        // Layer 0: Ambient Background / Sky Fill  
        this.ctx.fillStyle \= gameState.backgroundColor;  
        this.ctx.fillRect(0, 0, 320, 200);

        // Layer 1: Background Tilemap  
        this.drawTilemap(gameState.map, gameState.camera, 'background');

        // Layer 2: Y-Sorted Entities (Hero, Monsters, Items)  
        this.drawEntities(gameState.sortedEntities, gameState.camera);

        // Layer 3: Foreground Overlays (Pillars, Arches)  
        this.drawTilemap(gameState.map, gameState.camera, 'foreground');

        // Layer 4: User Interface HUD  
        this.drawHUD(gameState.playerData);

        // Final Blit to Screen Canvas  
        this.displayCtx.drawImage(  
            this.offscreen,   
            0, 0, 320, 200,   
            0, 0, this.displayCanvas.width, this.displayCanvas.height  
        );  
    }  
}

### **WebAudio Sound Engine and Tracker Module Emulation**

Audio playback requires executing original 4-channel ProTracker MOD files (composed by Nation 12 / John Foxx) alongside sample-based sound effects5. Two modern architectures effectively achieve this:

> 1. **WebAssembly libopenmpt Integration**: Compiling the native libopenmpt C/C++ tracker library to WebAssembly via Emscripten (chiptune2.js) provides a full-featured module playback pipeline. The engine outputs raw PCM audio streams directly into a ScriptProcessorNode or AudioWorkletNode.  
> 2. **Software Paula Chip Worklet**: Implementing a custom AudioWorkletProcessor that emulates the Amiga Paula sound chip in pure software. The worklet processes pitch periods directly using the PAL Amiga clock constant:

![][image25]  
By performing sample resampling and period interpolation directly inside the audio worklet thread, audio playback matches the timing and pitch of original hardware19.

## **Porting Architecture Reference Matrix**

| Subsystem Category | Legacy 16-Bit Implementation | Web HTML5 / JS Architecture | Architectural Notes & Conversion Requirements |
| :---- | :---- | :---- | :---- |
| **File Compression** | Rob Northen RNC1 (LZ77 \+ Huffman)6 | Custom JavaScript Bit-Stream Unpacker | Bit-level sliding window parser reading right-to-left6. |
| **Graphics Asset Format** | Interleaved 4-bitplane planar (![][image1])3 | HTML5 Canvas ImageData / WebGL Texture | Map 4 bitplane words to 16-entry RGBA palette array4. |
| **Collision Data** | Embedded 5th bitplane binary mask3 | Uint8 Flat Bitmask Array | Serves as narrowphase pixel-exact collision layer3. |
| **Map Architecture** | **![][image7]** continuous map grid7 | Unpacked 2D Typed Array (![][image11])8 | Extract 16-bit word cell flags for visual ID & depth8. |
| **Game Timing Loop** | 50 Hz PAL vertical blank interrupt1 | Accumulator loop via requestAnimationFrame | Enforces deterministic ![][image23] tick updates1. |
| **Randomness Engine** | 68000 register soft PRNG1 | Linear Congruential Generator (LCG) Class | Guarantees reproducible frame-by-frame RNG runs1. |
| **Music & Sound** | 4-channel Paula hardware module19 | AudioWorklet / WASM libopenmpt \[cite: 20, 22\] | Synthesizes ProTracker MOD files and dynamic SFX20. |

#### **Referenzen**

> 1. Speedball 2 reverse engineering & remake \- English Amiga Board, [https://eab.abime.net/showthread.php?t=61305](https://eab.abime.net/showthread.php?t=61305)  
> 2. Gods Viewer \- Kroah's Game Reverse Engineering Page, [http://bringerp.free.fr/RE/Gods/utility.php5](http://bringerp.free.fr/RE/Gods/utility.php5)  
> 3. \[Ripped\] Magic Pockets \- English Amiga Board, [https://eab.abime.net/showthread.php?t=22437](https://eab.abime.net/showthread.php?t=22437)  
> 4. Gods reverse engineering \- Page 4 \- English Amiga Board, [https://eab.abime.net/showthread.php?t=60678\&page=4](https://eab.abime.net/showthread.php?t=60678&page=4)  
> 5. Gods (video game) \- Wikipedia, [https://en.wikipedia.org/wiki/Gods\_(video\_game)](https://en.wikipedia.org/wiki/Gods_\(video_game\))  
> 6. Magic Pockets Viewer \- Kroah's Game Reverse Engineering Page, [http://bringerp.free.fr/RE/MagicPockets/utility.php5](http://bringerp.free.fr/RE/MagicPockets/utility.php5)  
> 7. Chaos Engine level viewer \- Page 2 \- English Amiga Board, [https://eab.abime.net/showthread.php/showthread.php?p=494847](https://eab.abime.net/showthread.php/showthread.php?p=494847)  
> 8. \[REQ\] Chaos Engine \- Page 2 \- English Amiga Board, [https://eab.abime.net/showthread.php?p=408265](https://eab.abime.net/showthread.php?p=408265)  
> 9. hansbonini/sega2asm: Sega Genesis / Mega Drive disassembler and splitter written in Golang \- GitHub, [https://github.com/hansbonini/pysega](https://github.com/hansbonini/pysega)  
> 10. Ace Magazine Issue 25, [https://archive.org/download/Ace\_Magazine\_Issue\_25/Ace\_Magazine\_Issue\_25.pdf](https://archive.org/download/Ace_Magazine_Issue_25/Ace_Magazine_Issue_25.pdf)  
> 11. Issue 4 PDF \- Downloads at abime.net \- YUMPU, [https://www.yumpu.com/en/document/view/10459636/issue-4-pdf-downloads-at-abimenet](https://www.yumpu.com/en/document/view/10459636/issue-4-pdf-downloads-at-abimenet)  
> 12. Ds1edit docs \+ usefull links \- The Phrozen Keep, [https://d2mods.info/forum/viewtopic.php?t=24258](https://d2mods.info/forum/viewtopic.php?t=24258)  
> 13. Very early Gods from the Bitmap Brothers implementation using AthenaJS \- GitHub, [https://github.com/AthenaJS/athenajs-gods](https://github.com/AthenaJS/athenajs-gods)  
> 14. Gods \- Bonus FAQ \- Genesis \- By BioSpark8000 \- GameFAQs \- GameSpot, [https://gamefaqs.gamespot.com/genesis/586213-gods/faqs/51351](https://gamefaqs.gamespot.com/genesis/586213-gods/faqs/51351)  
> 15. Gods \- WikiClassics | Fandom, [https://retrogames.fandom.com/wiki/Gods](https://retrogames.fandom.com/wiki/Gods)  
> 16. GODS Remastered \- Steam Community, [https://steamcommunity.com/app/628720/reviews/?browsefilter=toprated](https://steamcommunity.com/app/628720/reviews/?browsefilter=toprated)  
> 17. 2d ladder on a player that has gravity : r/godot \- Reddit, [https://www.reddit.com/r/godot/comments/wmgonu/2d\_ladder\_on\_a\_player\_that\_has\_gravity/](https://www.reddit.com/r/godot/comments/wmgonu/2d_ladder_on_a_player_that_has_gravity/)  
> 18. Fix for wall jump problem \- Physics \- Godot Forum, [https://forum.godotengine.org/t/fix-for-wall-jump-problem/107548](https://forum.godotengine.org/t/fix-for-wall-jump-problem/107548)  
> 19. FroggyMe's Web Amiga MOD Music Player \- pwh on the SDF Public Access UNIX System, [http://pwh.sdf.org/web\_mod\_player/](http://pwh.sdf.org/web_mod_player/)  
> 20. GitHub \- RednibCoding/Paula-Tracker: A classic 4-channel sound tracker inspired by the legendary \*\*Ultimate Sound Tracker\*\* from the Amiga era. Built with modern web technologies (ES6 JavaScript, Canvas, Web Audio API) while maintaining that old-school demoscene aesthetic., [https://github.com/RednibCoding/Paula-Tracker](https://github.com/RednibCoding/Paula-Tracker)  
> 21. jotd666/gods-deluxe \- GitHub, [https://github.com/jotd666/gods-deluxe](https://github.com/jotd666/gods-deluxe)  
> 22. deskjet/chiptune2.js: much like chiptune.js \- but newer and neater \- GitHub, [https://github.com/deskjet/chiptune2.js/](https://github.com/deskjet/chiptune2.js/)  
> 23. libopenmpt · GitHub Topics, [https://github.com/topics/libopenmpt?l=javascript\&o=desc\&s=updated](https://github.com/topics/libopenmpt?l=javascript&o=desc&s=updated)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAWCAYAAAB+F+RbAAABa0lEQVR4Xu2WvytGURzGvxnwBxilmJQyGmS4FBZlIIP/AL2ibCZZLWaD0eAfMGIRSbEpJlKS1UB+PN/OebvnPp1z72t4T27Op57ec57n3u73ub23jkgikag7G9ASm8Qm9Gk1Tdmf5wB6h76tlotxgQ9oz667oC+oO4/rRVnZV+jF2e+KuX7E8WpFqGy/mKyP/GHah6i6zvfMthMqeyYmUzqhSSdrhVtolE3LMTTLZgxCZZvfs37fGTRk9/pXbpU7Mfe6nEBz5EVDC6ywKXnZLccbsF6v41VxD43b9Sm04GTR0eEbbEpellHvic0KtPAltMhBbHT4VTalvKzPL+NKTOEpDmKjg6+xCc7FX+q3ZbXovF3fQBNOFh0dfJ1NMCj+UurtsxnALdpEC2fkRaFHzPA7HFjeoCNnr8dG3wvwcQHNsGm5hsbYbBeHYk5Gj9CD/X0Wc4RkNNeCmulRsaMYB8nYILbZSCQSiX/DD+FBVhhb+Wk5AAAAAElFTkSuQmCC>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFYAAAAaCAYAAAAtzKvgAAADhklEQVR4Xu2YS6hNURjHP8/yDomIUqS8jTySy0CkDBgQRRLqTsxIYaA8BoiQvJJHMvEcUgYoJBNMTLzf8k7I+/tba9393f9Z+5x9Nle3Y//q39nr/+21H99e61t7H5GCgoLmzXg2KtBa1Y3NWqO7ajCbVfBR1YLNDLxVdWKzEq9UP42+qSb42BuKffc+mE+xDyb2txktyXkuUSwrF1R1bFYBzp2LcOFMe3H+Vw54Yn2airyJ7S9/fp3rVdfYzAISh5O35YCkJx08YKMJyZtYzLwZbOYA56+6lNSL67iHfNS1kNhZFJstSdn4F+RNbNqgqBaUwrVsZiE2Mk+renr/PcXeUdsyXXVHdVw1jGJzVWtUR317mWpBQzRhkuqIarFv50nsQim9JwsGUji+BXWd2SVuDaqakFg73MNFxZKO1TLGF9Vq076vumzaKyU5HkbBcL+NJATgn/PbKE/PJF9ir6oes+nBdbYSd1w8xMAi7zHjJO5XZJW4jijUoI1qr9++4mMTfbtONdNvW+6qfrApru8U097sPcwGcFaSB/rcx5g8icW1XGRT2S8uqQDHnWZiL73H9JK4nwl0DJ2R1LCYDfB+WKwe+V8G+2xhUxofF2yktgX+bjYlX2LR5yCbksyo2HWgfZK8AO+bGZsAPoiNYRox/cTF13FAsid2oDh/BQfE+bakZAF9DrBpQBxlJhBKwyjjWWLXnImt4jovVZ2i2G0fm6daQrEA4rERkjWxPcT5mKoMfJSkavisOs+mAce0JW2592KERTwXLSVJAn8jjzWxNBDDeyMDH3U0sMl7MeDfY1Ocj8UosENcSeqquql6LaXXfF31kLxALFF402EvMEbSY5kol7xyMRCm8hDj7fSe5XDEC4QH2NF4eG2DZ0sQ3i4wso/5NhY/fqiYWWnnAYjhrQQM9W2eqYHtUv5YFTkk6YvEC3HTpRwdVLckeQj7God//6/wRNxIeipuujKDJOmPlb2vadubsw8A78uxG495gfBqBW3zv2l/9ODrdAObtYpN2gnVGdMOYJ/JbCq9qY2+5R5CuVhNgcTw6I0xUkrfrVGXsT/KFEAZQXtqwx6NQdm5wWatgs9R1FjcMD4qsPCmgdKDBAf6qD757S7ikjonCZeQ9tBqEtxsZzbLYP9PBlgksfCFL800sA4g+f8FdeISO4IDFbD/CWShnbiFs6CgoKCgmfALuf0N7YMmkXEAAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAbCAYAAABFuB6DAAAAm0lEQVR4XmNgGAUDAr4C8VsgPgPEgkD8H4gvQWkWmCI3IHYGYiWoxAOYBBAcBeJ/MM4XKN3FAFGIDLqxiDH8xiL4EIsYWOA6FjGsCsOxiD1DFgB5CF1nNFSMA1nwOFTQB8pngvLD4CqgACR4C4gvQ9mgkJBCUQEFIEmQVXiBHwOm+7CCDwwQhVlALI4mhwJcGCC+DgBiRjS54QkAahspjFGixIQAAAAASUVORK5CYII=>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAaCAYAAABhJqYYAAAApElEQVR4XmNgGAX0BrOAOBVdEAjM0QV+ATEzEP8HYkck8RSoGBzMY4AoBAGQhBeS3BuoGBzUQuludAkofz2aGBiAJF4g8WHOMkQSgwOQRBASvwwqhgHEGTAlPmIRgwOQhB6UrQPlb0BIowJYMIHwJCithaICCqTQ+DsZcDhBkAEiMQ3KZ4TyPeAqkIA0EH+HsvkZIAojEdKYwBKI1wBxG7rEiAIANi8lEIyWivoAAAAASUVORK5CYII=>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAaCAYAAACD+r1hAAAAjElEQVR4XmNgGAWDEUwE4lQkfgcQ1yDx4UAciC9B2blA/AuI/0P5Z4G4B8qGA5gkCPBA+fpAbAFlRyDJg4EREruMAdUADiQ2VvCJAVUDQQBSvBhdEBkIMEAUKTMg3K+FJH8ViQ0GMxkgijiB+ByUrQiVA3l8BZQNB4wMEEUg7MoAsQnGr0NSNwqGMgAAUAQcMsPKGnkAAAAASUVORK5CYII=>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAF8AAAAWCAYAAACmG0BRAAACRklEQVR4Xu2YvWtUQRTFb5QIWogxoJH4ETBgxDQiBCzzH9gYwSYrfv4JpgjYp4pWopDSyiJICCRgEyxUCBFFK7EQxUJU/MIP1Nyzc8d3OTvrrrtNHm9+cMicM7Mpzns7b96KZDKZTKbqHFD94dCYVn1UfVWdpbnIHtUTCf/jJs0xNySs+6Y6RHOVBGWkyn+qWnYeBd9zHlyU8NlN5s+pfhfTf9ksYd1587vMV5ol1RdpLGJ7IgPIdtgYhcPPFtN1kF1LZHecf2RZr8sqxV7VvOqtNBa9lsiA31pOmj9dTNfhb9IZ8z0uA0PkU+AC93FIXOCgDMSCUuVzgRGfz9n4RDFdB9uO/+x35/GNGnNz7fBZtZtD45VqmMONzm3VPht3Wv6kjVvd+dE/Vh1RHTd/yq1pBR74g5S9Vo1QtuHpV911vtPyo7/qfMx4DTTusppl8UHdDv4CoPjDbq40cKndlH+Z/IKEY2SqfA/2f2S3KG8FLgCKH+WJMnBdGr+q3ZQPjqruSziG7pTGNewjyHDS+h/eqT6o9vNEGVhUrZBiORjHk8wnyxhkzzgksOal8z8sY5DhLm4XFB9vHFwAnNZKT+rOnEhkANkx8u+dx7kdmT+dXLLMg3cFZJOUN8MXH8EF4Idw6UiVD5ChuMiMZR74F86jJGxBDNZNOY+Xu1/O/wtsiwc5NHDhBzgsA6uqNxK2CAjjh25+q4TSHkh4I8WDlF+UahLWPLe/zX7b2SbhvP5TwnsAtrV22CKtt5crHGQymUwmk6ko6zwzumxwetmvAAAAAElFTkSuQmCC>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAWCAYAAAAxSueLAAABfUlEQVR4Xu2UzStGQRTGTz4iRBZKoWTlP7BgZ8EfwEahWPkTLKwsLOwoUXbKShYWys4C2VJSPjZKWShSPvJ9nnvOzHvueUfKTt1fPd33ec6ZudPcmZeo4D/Tx7plfbEOWRX5csY9a5TVzGpiDbHuch0lOlk3JPNt2cIia8n4J5KmLpMBZF7tuQ5hmfVm/CZrJxgM6inVYgb5bI5kYf2uFkCeGoddoXo1qYZU9hvoOXdZqzWzrF4b0N9e1kjSg88CBljVpfLPYNBnIjtjnbAOWO+sKlOf0p5p1gbJru2yXk1PGcckg+pcjqzG+G3NAivq/Q7AH7ksAwcFxRZfSNBN0jujfl79euwQPjTPgfvjV2+pdB53Ef2n6sfVT8YO4UHzSBhoWTO/L0jqtSZr0GxPPS46PL6d5VHziD8MwGZXJIMsgySTjJgMftX4kMWX4bSEwCvQwbo0Hrywnl02QeU7BJ/9CbSpSclPNKb5tT738+XIAkkdi8NzOF8uKEjwDQdzd7AFX5ApAAAAAElFTkSuQmCC>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAWCAYAAADNX8xBAAAA/klEQVR4Xu2TvQ4BQRSFRyERolTrJBKtQrwBpUojKipeQVRewBuIQivRarQiRKGh8pOIwk+jw73m7Gbmmi00Kl9yss53d6/NJKvUn2+JUzaUJ2UmZi5ulJKUVaUXhNFblKs//aSu9P3WogRkxHDcOUGclGOR66Go6CYXXJ2LlvidU/qsgqgofQyMtSgN0acsKDFKF84FH7CHtagMIR98UO7CHSkho1uLihAHf6wZw3sUKE2jM9aiJETPH2uG8Fl0+XaM87AHpiBG8Cn0icgU8xX6GxZrr4A5fBD8Bx9vlIE04d4WziSv9D01OWhg4H1rHXtscabsKVvKDv3Pr3gBIJNK++ZPwtQAAAAASUVORK5CYII=>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD0AAAAWCAYAAABzCZQcAAACf0lEQVR4Xu2WS6hNYRTHFwOSR8JAiVImiDwGlzwGzJAiTJCkRBnciYncbgl5DJSUbt2BMpCZCQNmYoIB5TH2jlIeEYOL//98a+2z9jrfPu1z7+y2f/Xv7PVf397f/u/z7YdIQ0PDeGUqdBf6Bz2GJpTbPTMAfYd+QYdCL3IdWhy87ZLOpY6M6FepxTwtpmg9W+uJNqBHXkL3XP0ceuhq8gD6K+0TWVJuFxyV1D8XG2CypN6C4JfCBfhHtPgJ3XQN8gT6Hbw6zJD8hPRmRhOsknqhz8SGchzaG7xuoXmhWnDAHtcgJ9TvlaeS34/ecDSlfujTwefqJLwNh3xD8qEX+WKjpAHrvQkOqD8Lmg9tgNZAfdAmHbMOWgGt1G2Sm5BU+aMNfd9tb3XbJDdXqe5Xg5N7dqvPkMugQa2p8zqGDynWb6Fj6uUmJFX+aELflnLoSJzLHooFp9RY7k2wQ31/v0xS75LWn6E57XaLOKFR5VvopbGhWOioOqGjCg6rwWXq2aX+5uDvU/8qdDD0SMcESpVvobmacuT+ae5TJ3T0CuyeXutNsF99e2B4XkjnQY3chKTKt9BxpRm50GRMoe1d18vT2w76JjbAD8nvR+9VNKUdOq40w0KfjY0u5EJ3wAGXg3dH/cg3SR8xcyX17QFm8OLl9qO3OprSDs03QA4LfSE2ulArdO5fZb3T1dOgd9BX592SNG6h8wi9I66+qF6OLZJ622JDOSmpfy34VUyXmqHJDWhEf7kDX2XGFeijpNBfnM8L8F7lLwZXAo/xCHom6csufsvzyf9J0jH5yuMvvdfa52uGc/HY1uf4P9rPwVX4QdJ4iudcfHY2NDQ0jBv+AxOX6p+XgDp0AAAAAElFTkSuQmCC>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAWCAYAAAB5VTpOAAACAUlEQVR4Xu2Wu0tcURDGBx8oKkoKiaCCCD6KVAG10C4B/QO0EaJgKnsbCysLC7GJIAp2gpVYWAh2FjHYKoohKkHBByJEBB/4ns9zzu7c2buuinvdwPnBx935ZnbvznDuuYfI4/F43oYW1jHrnrXMygqmHzlhfWN9YJWw2ln/AhVxqliHZH5vLpjKfEZZYyI+J9NItfAAPK2KQIVhnHUt4lnWgogzHjTWFOJB2hsiM7wvKueAH/Y9rK7/gkJK3nyYlwrUbCqvTMXJ6NOG4qM20sUgq1l5rxlIMZkaPIKglZUbT6cE+9iaNi21rD1tRgkauwvx/rDWWb9YN6wcke+1Nf2sGTKrb5F1JWpSgUcO95DUsQ6UFymrZBorUD68PBHPW88xYWO9khCvKO8pvlL8scMw8LZ6N7C5ooFSnQihnkztgI2HbTwdqzDcWv8luKEc6USU4HyhV4EkW8U4q6B+w8bdNv4eqzCcWv8lfCazMv7qRFS45iRT4vMWmXy+8Iqs99PGOKwhxl4iObP+c8Ew3J7RSObekaM3UCC9XTKNSdrINNopPMSTInbecweCYewrD0PRG21awVvA/WktRyVrW8TgknWhvB5KbB5xsoOc5BNrR5uWBtZvbaaDckocgpNutsv6OA/guhRMx/hBJo8B4toRTCdlRBuKGm14PB6PJ4N5AJaEidBJtLLbAAAAAElFTkSuQmCC>

[image12]: <data:image/png;base64,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>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAaCAYAAADFTB7LAAABi0lEQVR4Xu2WOy9EURDHRygoKKgUCCWdUOILUJKofACJRC+ilUiEkGgpFBISjw9AISqtREM2Su9nvPlPZk7u7FiKzdp7ivtLfsmcmXPPzp49d+8lyshIn1X4DL+Mx3kziCpMjX3IL5eHXZIPn3D5wBLc9slyUk/JDnl64aFPpkGhBrnxe5dLjRWSBudMzjecKlWUv4ufsDIpx0Fo8Bo2uVoUzJI0OOQLsXBOkZ07T6E7ORrCE2PLF5TQfAdcg++wAR7AHXiUTKUeuAmn4aXJhzXGSa77gIOm/iczJBf3+YKB66MacxN2tzmu03gKTmo8Bvc0ZnhejRvXmvEPluEdvCL5trf0+/PWNtQN38yYa/bOb4cbJOuemLw/QrzGossVjV28k+RFI8C1Zo3P4LrG/fBUY8Y3yGvMu1zR2MW74KsZc63FxHymmQWYo+QtiWuNGodxSXiEF/CG5OflP3M+Ek/wRWPOtZKcT34ScWNtOmeEBG5oGO7rnGrNR0PJduw/4HPLDQ74QkZGjHwD315rsDflaYUAAAAASUVORK5CYII=>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADkAAAAaCAYAAAANIPQdAAAB/klEQVR4Xu2XOUtdURSFtwOICin8Af4BG3EgIPgDYkC72AqCTcBGEDVdEtAuTbBRHBJQsBAbKxEhnY2lqI0TihmMEjM5Eddi7+M7Obz70ELxyPlg8e7da797zz7jeyKJROIhMwb9gP55+mxeEfQl8L5DLeZHhysiH0ui3pPQiAmOGItYCQ2jUAdEw0vRIlpDw6B3GgZjg2swa6SaRb3XoREbbjq2Qc9FN5ZnpmXzyq+zI4VFrEM9gXrNyxrlaHDrMetYeBTr8atkj1STqPcmNGKj0HRcEPUqQiMmSkSLuO35OAkNQXPyv78NDUOfRGdBv/mcCfPQnuWVQhei6/7QYqQeWoPGoVmLuTbUQDPQOVRl3o14J/qAF6EhuptmFenHftsnNy6ub9IHDdr1APTXrt/aJ7/PDibMG5HcDxLHGVRt14y7Z/NI27XrgkxDJ9CRaE8eQ5fmVUI/LUaPOWwkjxfHluiLWaDrVd4XuwQPFjwVxJjLhlIH0D7UGcT57C4v39EouU67U9gR7PluyTXAHx0fFjkRxPLNjnbJHyd+vE7uqUj2vMO9cBH66MVdzivogxcnm9BT755rjfizoQyq9eKOBtGpfOdwE+HRw6nW4cUnoD/Qjt2zQP41o8KGjYouiVUvxgI3RDef9xb7BX0TzeVUdUvM7QWJRCKRuDeuAGculoIdyXrzAAAAAElFTkSuQmCC>

[image15]: <data:image/png;base64,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>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAAAaCAYAAADheVNOAAAGGElEQVR4Xu2ad4glRRCHSz3TqYg5oWAAEQMeKmZv9QyYMWAAw+kpKIqYMd/pmRHEDOb4hyKoYMAcUERMiAHBwGJOh545a3/bXTe1tT1v3755d7dvtz8o3vSv53VPz3R1qBmRQqFQKBQK45e1vVAojHYWCrauFztgw2DHelFi+WcGO95njDUWCPZDsP+MzRp0RuQfqfI5Hq1sGmxFL9bwhMT2fB/sSJfXlB0klr2cz+gC9nk15UsvBPaW6tr5/WJw9tjkNomN7XO6pRs3fG6zq0QnGA7asnA6Pjilv6myG/OWxDLP9Rld4jDpzvP40QsSy52cjsm/0OSNWaZKbPjZTlceCraJF0chewTbzIuOx4I96LRHJLZ/L6c3YQMvdJEDpLkDMOtNcdoS0rzcnoSNEA1/1GcEJkrvTIN7yvAO8LfEtu5vtPWT9rXRRjP7SvOO+q8XAstI83J7Fho+24uBP70wimnHAVYLdqfT+iS2/3WnW1h2zAx2b0rvE+zWYMfMOSOySrDjgl0V7KCkrR5s22BbBNtc4h4Btg62cbBJ6dhyeLCvgt0ebLHBWQN1+466YLCbg30qcdly6uDsIbBMs3BtB0osd7dkLBO5jouC3S9xc3yJDJ0pTw/2crA3gx3i8mBqsIsllgEMODdJfF4Km/obJdZVB21iML7OZ3QDGu5v6rRg5zhtNNOOA+R4XGLbWy1bLpDqHhEIIIICnyVtQkqvJ3GJhXZe0jh3etKwy5L+a0rTaW3EhfJvSMcrSTxnnSp7iAPQMVulPVcHW9VpLKt41vzv5GQ4nm03+6QT0rGGT5lJbF3sG/4wacAhtYz+YEtJDMBo25+Xat/Bsb/2RZN2aEpvldK6j+sKeoFe6wZ3tbA7JI5yjKa3SBwZ7MPOsYhU19uu1aGd5VWfkeEdyZeF5mdKNHUARa/7ypSmQy1fZQ+gG+hWmncAZhz/H/ZtdfhzlbolEDOj6nQ69lEKkSSWlRbO3dlpOlDY2eykpPkoHNpGJs1A8YtJA3V+67RGUKlt/HvBVjDpXqCTGeA3ab30sbwh+Q6SG7VIewcAlgjkMcIf4fKAvA8kjvxq05OueAdYNqUxRvc1TJ5naYkDT446B2BwyOk5VpZ47olO70+6hXcQXgO0PpdmoLT3RGftrkFH0AKZ3l40eb3CSB3g3WD3ebEFdR1hpkTdjlqkcw4A1JsrB9DfDrZjxhTvAKCOpcb7ghw4K7Nejk4dQNvDLM4z4JjR3fJh0i1HZTRA030SqwHSd8vQ+2HvSWOeklgRo0fuoppw+QiNTVInjMQB2JD5DRfr0VbUdYSnJep0IIV0nQNoJ/3EZ0jUWS60wjsAa2SLrttnOB1y16/oTOKpazegf5fR2ENYmNV8GdMyGqCpA2gaB5irTJdYEZ2AF0o5mLbvCfZCsJckhk39zZ+ftOsARC38JwBMq8NFF+o6AprXSeccYHawxaVaKvjPDX5Kuod7rmi0RuHZnWHSwL6Bt90WXhKe5jSLvv31vCZ5nU0p+lpORztF4t5O6U+6pdUMMMWlc18g9HuhCdtLrIhPA3IQrtMRjvMmpt9Jc86Y/7TjANxYrjtnu5jzcqgD2E7E2140wogWtCtMekmJI7tdmmi0aE2j6aacpYpC6PZJk9a1sy5lZqS0hRCqXyIM956DUCTl+I35R0n3EPJF57sh5f2kXRPsOaOzYfVlnJU0G83hPqHh5IpGwi41Gs+q7sVtR0yQWAnhqeHwDZnXNIkCed0asfRWqANsk34xIhT2mx/2A3Q0OjsREkKC16ZjtFnVqQPO8Hkyv2Z/Rao66EwK0RDOZ6amkz8g0QH2kxhV0v8cnc63/OwFw18Sr5FyKZ+ZCrguYu9aH3VY6IhaJ5EZ7sXuKU10CmgzbacM7g2OyUyn7aBeZiucR+sij3ur8Mw/lqouv8eYZxArz31DMh6oWwr0ArzI28mLhfZhF399sGelmooerrLHBURnetUBfKy+MELOD/aMxCnud4mhL/82cSzDG1BeduEArPvtur0X4DOFQqFj2DxvKXGzu53EjWmvgMOykSwUxiWTvVAoFAqFQqFQKBQK443/ASVK4LTzZGinAAAAAElFTkSuQmCC>

[image17]: <data:image/png;base64,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>

[image18]: <data:image/png;base64,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>

[image19]: <data:image/png;base64,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>

[image20]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAaCAYAAABYQRdDAAAA90lEQVR4XmNgGAW0AIxA/AGI/yPhtygqIOAvA0IexCYKzGeAaHBAE0cGIHmSQAIDRFM1mjgMbARiY3RBQkCZAWLoNnQJIOAC4mfogsQCkKEf0QWB4Be6ACkAFhHIIBmIa9DESALYDEXnkwzQDb0GxKJIfLLAdwaEoaCIO4IkRzbYwwAxVA5KUwXUM0AMewzEnmhyMDAdiJcC8SEgPsoASYLsKCrQgCMDxND36BJQYADEglA2SB0o/YJoQ7gKLICFAaIIVB4QAlQLHhjQAeJP6ILkgjtAPA2I9wNxB1RsC0KaPNAIxPuAWBiIfwDxVSCWQlExCkY4AACUszcz7x9HIwAAAABJRU5ErkJggg==>

[image21]: <data:image/png;base64,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>

[image22]: <data:image/png;base64,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>

[image23]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAWCAYAAAB+F+RbAAACaElEQVR4Xu2WO2gVURCGR4OPKIhKLESMYJHCNIKFoFZpUgWJgk3s0vhCVIgPUBRNZyCQQIooNsFC7WwtJSDaqIiWgg/EoOADVBQf83Nmbub+e05u5UVhP/i5me9Mdvfs2T33itTU1Pyv7NK80/zW3NMsbh5ucE7zSfNFM0xjrbgl6fhPNStorG1MaqZCjYngojYHB3CRd0L9RDMb6hJLJB2v2+oOq9c3OtoITrw94xBnFdUO3GqWxF3NK3Jjkj/eX2WlVCcG2D2k2oG7ypJAT3xywA7zbeeSZic5nizXTsk7/sieJb/J/B7yTpfmoGbcPkG/5rqm15uUQc1NzdHgHOw7WIiXmlEaawIX8ovq3KRK3tkqafwE+XXmT5F3sF9ckdQzrXlhHjcBbkTzQ9KTiUnBfbAe4Dc51lkeS2qMO2ZpUiXv9Eka5zu/xjwmtBC54380tzS4M+acw1RnwUaFJtz5SO6koOSdHknjx8j7CuEVWgj0PCf31nzkOLm1ViMTMv9N0MDv9jIekPKkSt5ZJGkcdz6y0fwQeQY9+MqLYGfncx7JuP3mKtfoz31kJvz9WarjAO4ZSwI9pd241XctevBaRbDh8LUcIscLdjEWcTNyotsn1RMAuG2hXi7pfYn8lOoFn5T88Rj04MdLJLey/I6e15wOdYPvMr/UnAjqA6G+bC7i/7clOPwUzfXhXWoF+rCSEey6fDysHJzvuhesbmKDyVy+hj7Qaf6+5pHmm6R3MrJb84Ac8JW8IenmXmserjAgaSPCRLGS783jEzX8nKQbiVfstbk3mtuSJrvXenw+NTU1Nf8mfwBt7cdc0GTVkgAAAABJRU5ErkJggg==>

[image24]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFcAAAAZCAYAAABEmrJwAAADT0lEQVR4Xu2XS8iOQRTHj1tKyP2SXBYuC0LKXRGKKAkb2dlgIyEi2UhZUAgbIZJcy8IllxULJIqQUMhdrkXK/fy/Oed9z3u+med7veqzML86vc/5z8wzM+eZOTMvUSaTyWT+BUPY3rL9YrvM1q6yuMRZCnXes813ZUpftisU6p13ZY3JBrZvbN/Z9royyxEKY73D1sqVKZjrCwrvwnurZiHbVuPvp9DZMKMBaC3kea74r8vFdYwXXRnq/MbiI5XH35HCGPw4MBdovcRvJn73Uo3AUbbnxkd83hm/kFjHXjvNdtz44CSFOjOMBn+R8cFXCruhsRjJ9oqtjdGGUxjbdaNdZHtqfLCR4rFoHtGmOi0KOoi90GrYDvDnGG2gaJgI6CI+fi2aShpiuRccXb2QANsW/d1yup8TnncYH4wRXdnsfAXaAy9Ww2oKjacZrQfbPuODCRTqXRN/rfiePRTXPeOofkCU/mzPvFgA8mhbp9ngagpYUy6uo7fos8THrouN3b6ramZSaLTFF0Q4Q6HuIPGRNmIdbqe4HmMS2z2nDaBwmPwNoymMAUEHehYsLdUIdBZ9pfipIKb0JMg36PwHhUkWoV/+qtEuiObBh4KO1V8Nk9nuyzMC+9KU1Qr6/2n8iaItNhpoL/pO8VNBTOkNgiCg4QlfYPhC5XSgHKB4h9so6P5QKEID7G8jtXCMwoKxIM1gTEuc3kn0deKngpjSq6Ko8W22w16kdM7dRXG9CFyjsGIf+oI/ZAHbBy8yTSiMaZXTe4o+T3w9yD1F8akAX1W3gaKNcchYcOdb77Qn8juWQptabwsKAqs5dgTVeCozo9geOc2OA8+p24Ledc+J74Fm00yU2RT/CqohtyorqP4dFtcjHFgK2uhJq3yi6i/dCKy9sAME2B9yDdGN7YYXqXKeWFQ3jQ8wR1sH7/GxAdCWeTEGKrY0/mDRThkNB5wG3NsUUw+rFFtJ0e3Xx2gpcOt47EUBfwLuejEBcrsfo9olUw+7EpoFvv23CrBCDxp/OtVvl6QDhRegwRv5tasR+EFaa2rqAayYzxRSCMpxOFXDJi84+nkhAVKcH6Oaz7G6Ug9RuNPuriwugTLsHvyrQ/3WlcWZTCaTyWQymcz/wW87SAb0CuhgxgAAAABJRU5ErkJggg==>

[image25]: <data:image/png;base64,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>