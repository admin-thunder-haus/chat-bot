// AI Actions framework — module surface. Importing this module registers the
// built-in action handlers (see action-registry.ts, channel-provider pattern).
export {
  actionRegistry,
  registerBuiltInActions,
  type ActionContext,
  type ActionHandler,
  type ActionResult,
} from './action-registry';
export { actionsService } from './actions.service';
export type {
  ActionExecutionOutcome,
  ActionRequestPayload,
} from './actions.service';
export { actionsRepository } from './actions.repository';
export { actionsRoutes } from './actions.routes';
