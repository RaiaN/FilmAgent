// Single source of truth mapping an agent's `icon` key → its Arco icon component.
// Used by the rail, the context menu, and the agent control panels so they all
// show the same glyph.
import {
  IconStar,
  IconUser,
  IconLocation,
  IconVideoCamera,
  IconBranch,
  IconApps,
  IconUserGroup,
  IconScissor,
  IconCamera,
  IconEye,
} from '@arco-design/web-react/icon';

export const AGENT_ICONS = {
  bulb: IconStar,        // Inspiration Board
  user: IconUser,        // Character Variations
  location: IconLocation, // Location Variations
  film: IconVideoCamera, // Animate
  story: IconBranch,     // Story Director
  board: IconApps,       // Storyboard (the panel grid)
  previz: IconEye,       // Previz (photoreal blocking frame → masked plate)
  cast: IconUserGroup,   // Cast & World (the ensemble: characters/monsters + places)
  deconstruct: IconScissor, // Deconstruct (a Take → its cuts + key frames)
  shot: IconCamera,      // Shot (drops an empty SHOT card)
};

export const agentIcon = (key) => AGENT_ICONS[key] || IconStar;
