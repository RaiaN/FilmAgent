import { createContext, useContext } from 'react';

// FilmCanvas owns the Auto Director plan state + executor and provides them here.
// The on-canvas AutoPlanNode (a React Flow custom node) reads live state via this
// context instead of through serialized node data — so callbacks never need to be
// stored on the node, and the node always renders the current plan.
export const AutoDirectorContext = createContext(null);

export const useAutoDirector = () => useContext(AutoDirectorContext);
