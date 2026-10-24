import { useSelector, type Equality } from '../state/store';
import { director } from './director';
import type { ViewState } from './types';

export { director, connectDirector, createDirector, applyEvent, playSpeed, EMPTY_VIEW, LOG_MAX } from './director';
export type { DirectorControl, DirectorOptions } from './director';
export { reduceView } from './reduceView';
export type * from './types';

/** Select from the displayed state (re-renders only when the selection changes) */
export const useView = <S>(sel: (v: ViewState) => S, isEqual?: Equality<S>): S => useSelector(director.view, sel, isEqual);

/** True while nothing is queued or playing */
export const useIdle = (): boolean => useSelector(director.idle, (v) => v);
