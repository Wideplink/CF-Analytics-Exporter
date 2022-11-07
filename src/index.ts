import type { CFZoneResponse } from './cloudflare/interface';
import { error, log } from 'console';
import { env, exit } from 'process';
import { inspect } from 'util';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import Cloudflare from 'cloudflare';
import { ClientError, GraphQLClient } from 'graphql-request';
import { DateTime } from 'luxon';
import { getSdk } from './cloudflare/queries';

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE, CLOUDFLARE_ACCOUNT, INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET } = env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE || !CLOUDFLARE_ACCOUNT || !INFLUXDB_URL || !INFLUXDB_TOKEN || !INFLUXDB_ORG || !INFLUXDB_BUCKET) {
    throw new Error('Missing required environment variables');
}

const cf = new Cloudflare({ token: CLOUDFLARE_API_TOKEN });
const db = new InfluxDB({ url: `${INFLUXDB_URL}`, token: INFLUXDB_TOKEN });
const sdk = getSdk(new GraphQLClient('https://api.cloudflare.com/client/v4/graphql', { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } }));

const queryApi = db.getQueryApi(INFLUXDB_ORG);
const writeApi = db.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET);
const newPoint = () => new Point('cloudflare');

let requestTime = DateTime.now().minus({ hour: 1, minute: 1 }).startOf('minute');
let adaptiveTime = requestTime;
let firewallTime = requestTime;
let healthTime = requestTime;
let workerTime = requestTime;
let r2StorageTime = requestTime;
let r2OperationTime = requestTime;

const zoneName = await cf.zones.read(CLOUDFLARE_ZONE).then(zone => (zone as CFZoneResponse).result.name);
const prefixQuery = `from(bucket: "metrics") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "cloudflare")`;
const suffixQuery = `|> group(columns: ["_time"]) |> sort(columns: ["_time"], desc: false)  |> last()`;

await Promise.allSettled([
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "requests_total") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > requestTime) requestTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last request time: ${requestTime}`));
                },
            },
        );
    }),
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "requests") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > adaptiveTime) adaptiveTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last adaptive request time: ${adaptiveTime}`));
                },
            },
        );
    }),
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "firewall_events_count") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > firewallTime) firewallTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last firewall event time: ${firewallTime}`));
                },
            },
        );
    }),
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "health_check_rtt") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > healthTime) healthTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last health event time: ${healthTime}`));
                },
            },
        );
    }),
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "worker_requests_count") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > workerTime) workerTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last worker request time: ${workerTime}`));
                },
            },
        );
    }),
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "r2_storage_payload_size") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > r2StorageTime) r2StorageTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last r2 storage request time: ${r2StorageTime}`));
                },
            },
        );
    }),
    new Promise((res, rej) => {
        queryApi.queryRows(
            `${prefixQuery} |> filter(fn: (r) => r._field == "r2_operation_request") ${suffixQuery}`,
            {
                next: (row, meta) => {
                    const time = row[meta.column('_time').index];
                    if (time && DateTime.fromISO(time) > r2OperationTime) r2OperationTime = DateTime.fromISO(time);
                },
                error(err) {
                    rej(err);
                },
                complete() {
                    res(log(`Last r2 operation request time: ${r2OperationTime}`));
                },
            },
        );
    }),
]);

async function doTask() {
    try {
        let shouldFetchTime = requestTime;
        if (adaptiveTime < shouldFetchTime) shouldFetchTime = adaptiveTime;
        if (firewallTime < shouldFetchTime) shouldFetchTime = firewallTime;
        if (healthTime < shouldFetchTime) shouldFetchTime = healthTime;
        if (DateTime.now().diff(shouldFetchTime, 'minutes').minutes > 30) shouldFetchTime = shouldFetchTime.plus({ minutes: DateTime.now().diff(shouldFetchTime, 'minutes').minutes - 30 });

        const zone = await sdk.fetchZoneAnalytics({
            zoneTag: CLOUDFLARE_ZONE,
            datetime: shouldFetchTime.plus({ second: 1 }).toUTC().toString(),
        }).then(res => res.viewer?.zones[0]);
        const httpRequests1mGroups = zone?.httpRequests1mGroups.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > requestTime) ?? [];
        const httpRequestsAdaptiveGroups = zone?.httpRequestsAdaptiveGroups.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > adaptiveTime) ?? [];
        const firewallEventsAdaptiveGroups = zone?.firewallEventsAdaptiveGroups.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > firewallTime) ?? [];
        const healthCheckEventsAdaptiveGroups = zone?.healthCheckEventsAdaptiveGroups.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > healthTime) ?? [];

        writeApi.writePoints([
            ...httpRequests1mGroups.flatMap(request => [
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('requests_total', request.sum?.requests)
                    .tag('zone', zoneName),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('requests_cached', request.sum?.cachedRequests)
                    .tag('zone', zoneName),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('requests_encrypted', request.sum?.encryptedRequests)
                    .tag('zone', zoneName),
                ...request.sum?.contentTypeMap.flatMap(contentType => [
                    newPoint()
                        .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                        .intField('requests_content_type', contentType.requests)
                        .tag('zone', zoneName)
                        .tag('content_type', contentType.edgeResponseContentTypeName),
                    newPoint()
                        .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                        .intField('bandwidth_content_type', contentType.bytes)
                        .tag('zone', zoneName)
                        .tag('content_type', contentType.edgeResponseContentTypeName),
                ],
                ) ?? [],
                ...request.sum?.countryMap.flatMap(country => [
                    newPoint()
                        .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                        .intField('requests_country', country.requests)
                        .tag('zone', zoneName)
                        .tag('country', country.clientCountryName),
                    newPoint()
                        .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                        .intField('bandwidth_country', country.bytes)
                        .tag('zone', zoneName)
                        .tag('country', country.clientCountryName),
                    newPoint()
                        .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                        .intField('threats_country', country.threats)
                        .tag('zone', zoneName)
                        .tag('country', country.clientCountryName),
                ],
                ) ?? [],
                ...request.sum?.responseStatusMap.map(status => newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('requests_status', status.requests)
                    .tag('zone', zoneName)
                    .tag('status', `${status.edgeResponseStatus}`),
                ) ?? [],
                ...request.sum?.browserMap.map(browser => newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('requests_pageviews', browser.pageViews)
                    .tag('zone', zoneName)
                    .tag('browser', browser.uaBrowserFamily),
                ) ?? [],
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('bandwidth_total', request.sum?.bytes)
                    .tag('zone', zoneName),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('bandwidth_cached', request.sum?.cachedBytes)
                    .tag('zone', zoneName),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('bandwidth_encrypted', request.sum?.encryptedBytes)
                    .tag('zone', zoneName),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('threats_total', request.sum?.threats)
                    .tag('zone', zoneName),
                ...request.sum?.threatPathingMap.map(threat => newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('threats_type', threat.requests)
                    .tag('zone', zoneName)
                    .tag('type', threat.threatPathingName),
                ) ?? [],
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('threats_pageviews_total', request.sum?.pageViews)
                    .tag('zone', zoneName),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('threats_uniques_total', request.uniq?.uniques)
                    .tag('zone', zoneName),
            ]),

            ...httpRequestsAdaptiveGroups.flatMap(request => [
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('requests', request.count)
                    .tag('zone', zoneName)
                    .tag('status', `${request.dimensions?.edgeResponseStatus}`)
                    .tag('cache', `${request.dimensions?.cacheStatus}`)
                    .tag('content_type', `${request.dimensions?.edgeResponseContentTypeName}`)
                    .tag('country', `${request.dimensions?.clientCountryName}`)
                    .tag('host', `${request.dimensions?.clientRequestHTTPHost}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('bandwidth', request.sum?.edgeResponseBytes)
                    .tag('zone', zoneName)
                    .tag('status', `${request.dimensions?.edgeResponseStatus}`)
                    .tag('cache', `${request.dimensions?.cacheStatus}`)
                    .tag('content_type', `${request.dimensions?.edgeResponseContentTypeName}`)
                    .tag('country', `${request.dimensions?.clientCountryName}`)
                    .tag('host', `${request.dimensions?.clientRequestHTTPHost}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('visits', request.sum?.visits)
                    .tag('zone', zoneName)
                    .tag('status', `${request.dimensions?.edgeResponseStatus}`)
                    .tag('cache', `${request.dimensions?.cacheStatus}`)
                    .tag('content_type', `${request.dimensions?.edgeResponseContentTypeName}`)
                    .tag('country', `${request.dimensions?.clientCountryName}`)
                    .tag('host', `${request.dimensions?.clientRequestHTTPHost}`),
            ]),

            ...firewallEventsAdaptiveGroups.map(event =>
                newPoint()
                    .timestamp(DateTime.fromISO(`${event.dimensions?.datetime}`).toJSDate())
                    .intField('firewall_events_count', event.count)
                    .tag('zone', zoneName)
                    .tag('action', `${event.dimensions?.action}`)
                    .tag('source', `${event.dimensions?.source}`)
                    .tag('country', `${event.dimensions?.clientCountryName}`)
                    .tag('host', `${event.dimensions?.clientRequestHTTPHost}`),
            ),

            ...healthCheckEventsAdaptiveGroups.map(request =>
                newPoint()
                    .timestamp(DateTime.fromISO(`${request.dimensions?.datetime}`).toJSDate())
                    .intField('health_check_rtt', request.dimensions?.rttMs)
                    .tag('zone', zoneName)
                    .tag('status', `${request.dimensions?.healthStatus}`)
                    .tag('region', `${request.dimensions?.region}`)
                    .tag('fqdn', `${request.dimensions?.fqdn}`),
            ),
        ]);

        if (httpRequests1mGroups.length) requestTime = DateTime.fromISO(`${httpRequests1mGroups.pop()?.dimensions?.datetime}`);
        if (httpRequestsAdaptiveGroups.length) adaptiveTime = DateTime.fromISO(`${httpRequestsAdaptiveGroups.pop()?.dimensions?.datetime}`);
        if (firewallEventsAdaptiveGroups.length) firewallTime = DateTime.fromISO(`${firewallEventsAdaptiveGroups.pop()?.dimensions?.datetime}`);
        if (healthCheckEventsAdaptiveGroups.length) healthTime = DateTime.fromISO(`${healthCheckEventsAdaptiveGroups.pop()?.dimensions?.datetime}`);

        if (workerTime < shouldFetchTime) shouldFetchTime = workerTime;
        if (r2StorageTime < shouldFetchTime) shouldFetchTime = r2StorageTime;
        if (r2OperationTime < shouldFetchTime) shouldFetchTime = r2OperationTime;
        if (DateTime.now().diff(shouldFetchTime, 'minutes').minutes > 30) shouldFetchTime = shouldFetchTime.plus({ minutes: DateTime.now().diff(shouldFetchTime, 'minutes').minutes - 30 });

        const account = await sdk.fetchAccountAnalytics({
            accountTag: CLOUDFLARE_ACCOUNT,
            datetime: shouldFetchTime.plus({ second: 1 }).toUTC().toString(),
        }).then(res => res.viewer?.accounts[0]);
        const workersInvocationsAdaptive = account?.workersInvocationsAdaptive.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > workerTime) ?? [];
        const r2StorageAdaptiveGroups = account?.r2StorageAdaptiveGroups.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > r2StorageTime) ?? [];
        const r2OperationsAdaptiveGroups = account?.r2OperationsAdaptiveGroups.filter(({ dimensions }) => DateTime.fromISO(`${dimensions?.datetime}`) > r2OperationTime) ?? [];

        writeApi.writePoints([
            ...workersInvocationsAdaptive.flatMap(worker => [
                newPoint()
                    .timestamp(DateTime.fromISO(`${worker.dimensions?.datetime}`).toJSDate())
                    .intField('worker_requests_count', worker.sum?.requests)
                    .tag('zone', zoneName)
                    .tag('script', `${worker.dimensions?.scriptName}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${worker.dimensions?.datetime}`).toJSDate())
                    .intField('worker_errors_count', worker.sum?.errors)
                    .tag('zone', zoneName)
                    .tag('script', `${worker.dimensions?.scriptName}`),
            ]),
            ...r2StorageAdaptiveGroups.flatMap(storage => [
                newPoint()
                    .timestamp(DateTime.fromISO(`${storage.dimensions?.datetime}`).toJSDate())
                    .intField('r2_storage_payload_size', storage.max?.payloadSize)
                    .tag('zone', zoneName)
                    .tag('bucket', `${storage.dimensions?.bucketName}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${storage.dimensions?.datetime}`).toJSDate())
                    .intField('r2_storage_metadata_size', storage.max?.metadataSize)
                    .tag('zone', zoneName)
                    .tag('bucket', `${storage.dimensions?.bucketName}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${storage.dimensions?.datetime}`).toJSDate())
                    .intField('r2_storage_upload_count', storage.max?.uploadCount)
                    .tag('zone', zoneName)
                    .tag('bucket', `${storage.dimensions?.bucketName}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${storage.dimensions?.datetime}`).toJSDate())
                    .intField('r2_storage_object_count', storage.max?.objectCount)
                    .tag('zone', zoneName)
                    .tag('bucket', `${storage.dimensions?.bucketName}`),
            ]),
            ...r2OperationsAdaptiveGroups.flatMap(operation => [
                newPoint()
                    .timestamp(DateTime.fromISO(`${operation.dimensions?.datetime}`).toJSDate())
                    .intField('r2_operation_request', operation.sum?.requests)
                    .tag('zone', zoneName)
                    .tag('bucket', `${operation.dimensions?.bucketName}`)
                    .tag('action', `${operation.dimensions?.actionType}`),
                newPoint()
                    .timestamp(DateTime.fromISO(`${operation.dimensions?.datetime}`).toJSDate())
                    .intField('r2_operation_response_size', operation.sum?.responseObjectSize)
                    .tag('zone', zoneName)
                    .tag('bucket', `${operation.dimensions?.bucketName}`)
                    .tag('action', `${operation.dimensions?.actionType}`),
            ]),
        ]);

        if (workersInvocationsAdaptive.length) workerTime = DateTime.fromISO(`${workersInvocationsAdaptive.pop()?.dimensions?.datetime}`);
        if (r2StorageAdaptiveGroups.length) r2StorageTime = DateTime.fromISO(`${r2StorageAdaptiveGroups.pop()?.dimensions?.datetime}`);
        if (r2OperationsAdaptiveGroups.length) r2OperationTime = DateTime.fromISO(`${r2OperationsAdaptiveGroups.pop()?.dimensions?.datetime}`);
    } catch (e) {
        if (e instanceof ClientError) {
            error(e.response.status, e.response.errors);
        } else {
            error(e);
        }
    } finally {
        setTimeout(() => {
            doTask();
        }, 1000 * 5);
    }
}

['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => process.once(signal, () => {
    writeApi.close().then(() => exit());
}));

['uncaughtException', 'unhandledRejection'].forEach(signal => process.on(signal, e => error(`Signal: ${signal}\n`, inspect(e, { depth: null }))));

doTask();
