# Cutwise

A small, offline-capable planner for cutting rectangular metal sheets into rectangular pieces. No dependencies, account, build step or external services.

Open `index.html` directly in a modern browser, or serve this directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then visit http://127.0.0.1:8765. A local server enables background calculation in a Web Worker; opening the file directly uses the same algorithm on the main thread. Keep all four app files together (`index.html`, `app.js`, `optimizer.js`, `planner-worker.js`) for offline use. There is no service worker or installation requirement.

## On the factory floor

1. Enter the dimensions and number of identical sheets available. Switch between meters and millimeters without changing physical sizes. A rectangular offcut can be your starting sheet.
2. Choose **Cut an order**, then add finished sizes and quantities. **How many fit?** uses one piece size and one sheet; it calculates quantity instead.
3. Enter the actual blade width, or zero for shearing. Edge trim reserves that distance on all four sides, including any material consumed when preparing the usable rectangle. Disable rotation to keep every piece aligned to the sheet's width/height axes.
4. Calculate. Review the whole-order quantities, select a sheet, then select a numbered cut to see its line and the rectangle being cut. P IDs identify sizes, not cutting order. A turn symbol identifies rotated pieces.
5. Follow the listed cuts in order. Each offset measures from the current rectangle's left or top edge to the **finished edge**. Keep the blade on the offcut side. X/Y positions are measured from the original sheet's top-left corner.
6. Save a JSON job to transfer or archive it; Open job restores inputs. CSV includes every sheet's pieces, cuts and offcut coordinates. SVG exports the selected sheet as a vector drawing. Print / PDF includes the order summary and a diagram and complete sequence for each used sheet.

Inputs auto-save on this browser/device when local storage is available, including unfinished jobs. Local storage may be cleared by browser settings; save a job file for a durable copy. Input changes mark previous results as stale and disable result exports until recalculation.

## Planning model and limits

- Rectangular pieces, rectangular sheets of one size per order; up to 50 sizes, 2,000 requested pieces, and 100 sheets. Capacity mode supports an area upper bound of 2,000 pieces on one sheet.
- Twelve deterministic guillotine heuristics compare four size orderings and three split strategies. Candidate plans prioritize the number of requested pieces placed, then fewer sheets, more finished area, fewer cuts and shorter total cut length. This is a heuristic, not an exact global optimization solver.
- Every separation cut spans the currently available rectangle. The algorithm records those cuts as it partitions the stock, so earlier cuts always produce the rectangles required by later cuts.
- Blade loss is calculated from actual cut bands; no blade allowance is required outside an existing stock edge. If less than a full blade width remains at an edge, the blade band can exit the stock. Account for this when checking machine constraints.
- Reusable offcuts are disjoint rectangles left by the cut sequence. Material used is finished-piece area divided by the full area of used sheets, including the reserved border. Offcuts, kerf loss and reserved trim are shown separately.
- Dimensions are kept as floating-point millimeters and displayed to six decimal places at most. Unit changes round display values to six decimal places. Use tolerances appropriate to your equipment; this planner does not model clamping, grain beyond global rotation lock, thickness, heat distortion, lead-ins, machine bed limits, minimum offcuts or irregular shapes.
- SVG is an annotated diagram with a margin around the stock. Its geometry uses millimeters; it is **not a CNC toolpath**. CSV cut positions describe finished edges rather than tool-center coordinates.
- Nothing is transmitted to a server. Job names are rendered as text. Imported JSON is size-limited and validated before replacing inputs.

## Verification

Requires Node.js (no packages):

```sh
node --test tests/*.test.cjs
```

The engine checks cover exact-edge fits, kerf, trim, rotation restrictions, multiple sheets, shortages, mixed-rotation capacity, invalid input, decimal dimensions, and 100 reproducible mixed-size jobs. Every generated sequence is replayed against the actual rectangles available at each step; tests also check non-overlap, blade clearance, part counts and conservation of area.
