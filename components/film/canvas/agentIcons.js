// Single source of truth mapping an agent's `icon` key → its Arco icon component.
// Used by the rail, the context menu, and the agent control panels so they all
// show the same glyph.
import {
  IconStar,
  IconUser,
  IconLocation,
  IconVideoCamera,
  IconRobot,
  IconMosaic,
  IconBranch,
  IconThunderbolt,
} from '@arco-design/web-react/icon';

export const AGENT_ICONS = {
  bulb: IconStar,        // Inspiration Board
  user: IconUser,        // Character Variations
  location: IconLocation, // Location Variations
  mix: IconMosaic,       // Mix & Match
  film: IconVideoCamera, // Animate
  muse: IconRobot,       // Prompt Muse
  story: IconBranch,     // Story Director
  auto: IconThunderbolt, // Auto Director (orchestrator)
};

export const agentIcon = (key) => AGENT_ICONS[key] || IconStar;
