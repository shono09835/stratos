import { Injectable } from '@angular/core';
import { Headers, Http, Request, RequestOptions, URLSearchParams } from '@angular/http';
import { Actions, Effect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, mergeMap, withLatestFrom } from 'rxjs/operators';

import { AppState } from '../../../../store/src/app-state';
import {
  resultPerPageParam,
  resultPerPageParamDefault,
} from '../../../../store/src/reducers/pagination-reducer/pagination-reducer.types';
import { selectPaginationState } from '../../../../store/src/selectors/pagination.selectors';
import { NormalizedResponse } from '../../../../store/src/types/api.types';
import { PaginatedAction, PaginationEntityState, PaginationParam } from '../../../../store/src/types/pagination.types';
import {
  StartRequestAction,
  WrapperRequestActionFailed,
  WrapperRequestActionSuccess,
} from '../../../../store/src/types/request.types';
import { environment } from '../../environments/environment.prod';
import {
  APP_AUTOSCALER_HEALTH,
  APP_AUTOSCALER_POLICY,
  APP_AUTOSCALER_SCALING_HISTORY,
  DETACH_APP_AUTOSCALER_POLICY,
  DetachAppAutoscalerPolicyAction,
  FETCH_APP_AUTOSCALER_METRIC,
  GetAppAutoscalerHealthAction,
  GetAppAutoscalerMetricAction,
  GetAppAutoscalerPolicyAction,
  GetAppAutoscalerPolicyTriggerAction,
  GetAppAutoscalerScalingHistoryAction,
  UPDATE_APP_AUTOSCALER_POLICY,
  UpdateAppAutoscalerPolicyAction,
} from './app-autoscaler.actions';
import { UpdateAutoscalerPolicyState } from './app-autoscaler.types';
import { buildMetricData } from './autoscaler-helpers/autoscaler-transform-metric';
import {
  autoscalerTransformArrayToMap,
  autoscalerTransformMapToArray,
} from './autoscaler-helpers/autoscaler-transform-policy';

const { proxyAPIVersion } = environment;
const commonPrefix = `/pp/${proxyAPIVersion}/autoscaler`;
// const commonPrefix = `/pp/${proxyAPIVersion}/proxy/${autoscalerAPIVersion}`;
// const healthPrefix = `/pp/${proxyAPIVersion}/proxy`;

export function createAutoscalerRequestMessage(requestType: string, error: { status: string, _body: string }) {
  return `Unable to ${requestType}: ${error.status} ${error._body}`;
}

@Injectable()
export class AutoscalerEffects {
  constructor(
    private http: Http,
    private actions$: Actions,
    private store: Store<AppState>,
  ) { }

  @Effect()
  fetchAppAutoscalerHealth$ = this.actions$.pipe(
    ofType<GetAppAutoscalerHealthAction>(APP_AUTOSCALER_HEALTH),
    mergeMap(action => {
      const actionType = 'fetch';
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/health`;
      options.method = 'get';
      options.headers = this.addHeaders(action.endpointGuid);
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const healthInfo = response.json();
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            this.transformData(action.entityKey, mappedData, action.guid, healthInfo);
            // if (healthInfo.uptime > 0 && action.onSucceed) {
            //   action.onSucceed();
            // }
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType)
            ];
          }),
          catchError(err => [
            new WrapperRequestActionFailed(createAutoscalerRequestMessage('fetch health info', err), action, actionType)
          ]));
    }));

  @Effect()
  updateAppAutoscalerPolicy$ = this.actions$.pipe(
    ofType<UpdateAppAutoscalerPolicyAction>(UPDATE_APP_AUTOSCALER_POLICY),
    mergeMap(action => {
      const actionType = 'update';
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/apps/${action.guid}/policy`;
      options.method = 'put';
      options.headers = this.addHeaders(action.endpointGuid);
      options.body = autoscalerTransformMapToArray(action.policy);
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const policyInfo = autoscalerTransformArrayToMap(response.json());
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            this.transformData(action.entityKey, mappedData, action.guid, policyInfo);
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType)
            ];
          }),
          catchError(err => [
            new WrapperRequestActionFailed(createAutoscalerRequestMessage('update policy', err), action, actionType)
          ]));
    }));

  @Effect()
  getAppAutoscalerPolicy$ = this.actions$.pipe(
    ofType<GetAppAutoscalerPolicyAction>(APP_AUTOSCALER_POLICY),
    mergeMap(action => {
      const actionType = 'fetch';
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/apps/${action.guid}/policy`;
      options.method = 'get';
      options.headers = this.addHeaders(action.endpointGuid);
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const policyInfo = autoscalerTransformArrayToMap(response.json());
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            this.transformData(action.entityKey, mappedData, action.guid, policyInfo);
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType)
            ];
          }),
          catchError(err => {
            if (err.status === 404 && err._body === '{}') {
              return [
                new WrapperRequestActionFailed('No policy is defined for this application.', action, actionType)
              ];
            } else {
              return [
                new WrapperRequestActionFailed(createAutoscalerRequestMessage('fetch policy', err), action, actionType)
              ];
            }
          }));
    }));

  @Effect()
  detachAppAutoscalerPolicy$ = this.actions$.pipe(
    ofType<DetachAppAutoscalerPolicyAction>(DETACH_APP_AUTOSCALER_POLICY),
    mergeMap(action => {
      const actionType = 'update';
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/apps/${action.guid}/policy`;
      options.method = 'delete';
      options.headers = this.addHeaders(action.endpointGuid);
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            this.transformData(action.entityKey, mappedData, action.guid, { enabled: false });
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType)
            ];
          }),
          catchError(err => [
            new WrapperRequestActionFailed(createAutoscalerRequestMessage('update policy', err), action, actionType)
          ]));
    }));

  @Effect()
  fetchAppAutoscalerPolicyTrigger$ = this.actions$.pipe(
    ofType<GetAppAutoscalerPolicyTriggerAction>(APP_AUTOSCALER_POLICY),
    withLatestFrom(this.store),
    mergeMap(([action, state]) => {
      const actionType = 'fetch';
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/apps/${action.guid}/policy`;
      options.method = 'get';
      options.headers = this.addHeaders(action.endpointGuid);
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const policyInfo = autoscalerTransformArrayToMap(response.json());
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            this.transformTriggerData(action.entityKey, mappedData, policyInfo, action.query);
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType, Object.keys(policyInfo.scaling_rules_map).length, 1)
            ];
          }),
          catchError(err => [
            new WrapperRequestActionFailed(createAutoscalerRequestMessage('fetch scaling policy trigger', err), action, actionType)
          ]));
    }));

  @Effect()
  fetchAppAutoscalerScalingHistory$ = this.actions$.pipe(
    ofType<GetAppAutoscalerScalingHistoryAction>(APP_AUTOSCALER_SCALING_HISTORY),
    withLatestFrom(this.store),
    mergeMap(([action, state]) => {
      const actionType = 'fetch';
      const paginatedAction = action as PaginatedAction;
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/apps/${action.guid}/event`;
      options.method = 'get';
      options.headers = this.addHeaders(action.endpointGuid);
      // Set params from store
      const paginationState = selectPaginationState(
        action.entityKey,
        paginatedAction.paginationKey,
      )(state);
      const paginationParams = this.getPaginationParams(paginationState);
      paginatedAction.pageNumber = paginationState
        ? paginationState.currentPage
        : 1;
      options.params = this.buildParams(action.initialParams, paginationParams, action.params);
      if (!options.params.has(resultPerPageParam)) {
        options.params.set(
          resultPerPageParam,
          resultPerPageParamDefault.toString(),
        );
      }
      if (options.params.has('order-direction-field')) {
        options.params.delete('order-direction-field');
      }
      if (options.params.has('order-direction')) {
        options.params.set('order', options.params.get('order-direction'));
        options.params.delete('order-direction');
      }
      if (action.query && action.query.params) {
        options.params.set('start-time', action.query.params.start + '000000000');
        options.params.set('end-time', action.query.params.end + '000000000');
      }
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const histories = response.json();
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            if (action.normalFormat) {
              this.transformData(action.entityKey, mappedData, action.guid, histories);
            } else {
              this.transformEventData(action.entityKey, mappedData, action.guid, histories);
            }
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType, histories.total_results, histories.total_pages)
            ];
          }),
          catchError(err => [
            new WrapperRequestActionFailed(createAutoscalerRequestMessage('fetch scaling history', err), action, actionType)
          ]));
    }));

  @Effect()
  fetchAppAutoscalerAppMetric$ = this.actions$.pipe(
    ofType<GetAppAutoscalerMetricAction>(FETCH_APP_AUTOSCALER_METRIC),
    mergeMap(action => {
      const actionType = 'fetch';
      this.store.dispatch(new StartRequestAction(action, actionType));
      const options = new RequestOptions();
      options.url = `${commonPrefix}/${action.url}`;
      options.method = 'get';
      options.headers = this.addHeaders(action.endpointGuid);
      options.params = this.buildParams(action.initialParams, action.params);
      return this.http
        .request(new Request(options)).pipe(
          mergeMap(response => {
            const data = response.json();
            const mappedData = {
              entities: { [action.entityKey]: {} },
              result: []
            } as NormalizedResponse;
            this.addMetric(action.entityKey, mappedData, action.guid, action.metricName, data,
              action.initialParams['start-time'], action.initialParams['end-time'], action.skipFormat, action.trigger);
            return [
              new WrapperRequestActionSuccess(mappedData, action, actionType)
            ];
          }),
          catchError(err => [
            new WrapperRequestActionFailed(createAutoscalerRequestMessage('fetch metrics', err), action, actionType)
          ]));
    }));

  addMetric(schemaKey: string, mappedData: NormalizedResponse, appid, metricName, data, startTime, endTime, skipFormat, trigger) {
    const id = appid + '-' + metricName;
    mappedData.entities[schemaKey][id] = {
      entity: buildMetricData(metricName, data, startTime, endTime, skipFormat, trigger),
      metadata: {}
    };
    mappedData.result.push(id);
  }

  transformData(key: string, mappedData: NormalizedResponse, appGuid: string, data: any) {
    mappedData.entities[key][appGuid] = {
      entity: data,
      metadata: {}
    };
    mappedData.result.push(appGuid);
  }

  transformEventData(key: string, mappedData: NormalizedResponse, appGuid: string, data: any) {
    mappedData.entities[key] = [];
    data.resources.map((item) => {
      mappedData.entities[key][item.timestamp] = {
        entity: item,
        metadata: {
          created_at: item.timestamp,
          guid: item.timestamp,
          updated_at: item.timestamp
        }
      };
    });
    mappedData.result = Object.keys(mappedData.entities[key]);
  }

  transformTriggerData(key: string, mappedData: NormalizedResponse, data: any, query: any) {
    mappedData.entities[key] = [];
    Object.keys(data.scaling_rules_map).map((metricType) => {
      data.scaling_rules_map[metricType].query = query;
      mappedData.entities[key][metricType] = {
        entity: data.scaling_rules_map[metricType],
        metadata: {
          guid: metricType
        }
      };
    });
    mappedData.result = Object.keys(mappedData.entities[key]);
  }

  addHeaders(cfGuid: string) {
    const headers = new Headers();
    headers.set('x-cap-api-host', 'autoscaler');
    headers.set('x-cap-passthrough', 'true');
    headers.set('x-cap-cnsi-list', cfGuid);
    return headers;
  }

  buildParams(initialParams, params?, paginationParams?) {
    const searchParams = new URLSearchParams();
    if (initialParams) {
      Object.keys(initialParams).map((key) => {
        searchParams.set(key, initialParams[key]);
      });
    }
    if (params) {
      Object.keys(params).map((key) => {
        searchParams.set(key, params[key]);
      });
    }
    if (paginationParams) {
      Object.keys(paginationParams).map((key) => {
        searchParams.set(key, paginationParams[key]);
      });
    }
    return searchParams;
  }

  getPaginationParams(paginationState: PaginationEntityState): PaginationParam {
    return paginationState
      ? {
        ...paginationState.params,
        q: [
          ...(paginationState.params.q || [])
        ],
        page: paginationState.currentPage.toString(),
      }
      : {};
  }

}

export const selectUpdateAutoscalerPolicyState = (state: AppState): UpdateAutoscalerPolicyState => state.updateAutoscalerPolicy;
