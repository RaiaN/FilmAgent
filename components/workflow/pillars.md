# Workflow Editor Pillars & Foundational Rules

This document outlines the core design principles and rules for the Workflow Editor in the ModelArk Starter Kit. All future development should adhere to these pillars to ensure a consistent, intuitive, and robust user experience.

## 1. Explicit Connections (No "Hacks")
*   **Rule:** Every data flow must be represented by a visible, explicit connection between specific handles (pins).
*   **Rationale:** Users must be able to "read" the logic just by looking at the graph. Hidden state transfer or implicit dependencies (e.g., "it just knows") lead to confusion and bugs.
*   **Implementation:** 
    *   Nodes must expose distinct input handles for distinct data types (e.g., separate pins for `First Frame`, `Last Frame`, and `Prompt`).
    *   The `onConnect` logic must enforce type safety and route data to the correct internal state based on the `targetHandle` ID.

## 2. Visual Feedback & State Reflection
*   **Rule:** The node UI must immediately and clearly reflect its current state, especially regarding inputs and outputs.
*   **Rationale:** Users need confirmation that their actions (connecting a wire, uploading a file) had the intended effect.
*   **Implementation:**
    *   If an input is connected/linked, the node should display a visual indicator (e.g., a thumbnail with a "Linked" label) instead of the default upload control.
    *   If an output is generated, it should be displayed directly on the node (thumbnail/preview) with relevant actions (Download, Reset).
    *   Loading states must be obvious (spinners, disabled buttons).

## 3. Direct Manipulation & Containment
*   **Rule:** Users should interact directly with the nodes on the canvas. Avoid detached panels or modals whenever possible.
*   **Rationale:** Keeping context is crucial. Users shouldn't have to shift focus away from the graph to tweak parameters or view results.
*   **Implementation:**
    *   **No Side Panels:** Results (images, videos) render inside the node card.
    *   **On-Node Controls:** Parameters (Seed, Resolution, Prompts) are editable directly within the node body.
    *   **Compact Design:** Use dense layouts, small fonts (10-12px), and icons to fit controls without making nodes massive.

## 4. Modularity & Composability
*   **Rule:** Complex behaviors should be built by chaining simple, single-purpose nodes.
*   **Rationale:** This promotes flexibility and creativity. Instead of one giant "Super Node" with 50 settings, allow users to mix and match.
*   **Implementation:**
    *   **Presets as Nodes:** Camera, Lighting, and Style settings are separate nodes that can be chained.
    *   **Prompt Aggregation:** Downstream nodes (like Image Gen) should intelligently "pull" and combine prompts from all connected upstream nodes.

## 5. Resilience & Error Handling
*   **Rule:** The editor must handle errors gracefully without crashing or losing state.
*   **Rationale:** Generative AI APIs can be flaky. A failed generation should not require a page refresh.
*   **Implementation:**
    *   **Try-Catch Blocks:** All async operations (API calls) must be wrapped in try-catch blocks.
    *   **Toast Notifications:** Show clear, actionable error messages (e.g., "API Key missing", "Generation failed").
    *   **State Recovery:** Ensure nodes can be reset (`onReset`) or disconnected (`onEdgesDelete`) to recover from bad states.

## 6. Consistent Aesthetics
*   **Rule:** All nodes should share a common visual language while being distinguishable by function.
*   **Implementation:**
    *   **Color Coding:** Use specific colors for node headers/icons (e.g., Blue for Image, Orange for Video, Yellow for Enhancer).
    *   **Handle Colors:** Input/Output handles should match the data type color (e.g., Purple for Last Frame).
    *   **Standard Components:** Use `@arco-design/web-react` components (Card, Typography, Button) for a uniform look.
