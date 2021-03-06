import { S3 } from 'aws-sdk';
import {
    Callback,
    CloudFrontResponse,
    CloudFrontResponseEvent,
    CloudFrontResultResponse,
    Context,
    Handler
} from 'aws-lambda';

import * as querystring from "querystring";
import { isArray } from "util";

import { Query, resize } from "./lib/resize";

// 型合わせ
const resultResponse = (response: CloudFrontResponse): CloudFrontResultResponse =>
    response;

// noinspection JSUnusedGlobalSymbols
export const originResponse: Handler = (event: CloudFrontResponseEvent, context: Context, cb: Callback) => {
    const {request, response} = event.Records[0].cf;
    const result = resultResponse(response);
    const uri = request.uri;

    // guard: check extension
    const ext = uri.split('.').pop();
    if (!ext.match(/jpe?g/)) {
        // response original
        cb(null, response);
        return;
    }
    // guard: check resize
    if (!request.querystring) {
        // response original
        cb(null, response);
        return;
    }
    // guard: origin status
    switch (response.status) {
        case ('200'):
            // keep going
            break;
        case ('404'):
            // response not found
            result.status = '404';
            result.headers['content-type'] = [{key: 'Content-Type', value: 'text/plain'}];
            result.body = `${request.uri} is not found.`;
            cb(null, result);
            return;
        case ('304'):
        default:
            // response original
            cb(null, response);
            return;
    }

    const query = parseQuery(request.querystring);
    console.log(query);

    /**
     * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html#request-custom-headers-behavior
     * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-event-structure.html#lambda-event-structure-request
     */
    const hostname = request.headers.host[0].value;
    const bucket = hostname.replace('.s3.amazonaws.com', '');
    const key = uri.slice(1);
    console.log({s3uri: `s3://${bucket}${uri}`});

    const s3 = new S3();
    s3.getObject({
        Bucket: bucket,
        Key: key, // remove first `/`
    }).promise()
        .then(data => data.Body)
        .then(buffer => resize(query)(buffer))
        .then(buffer => {
            // response resized image
            const encoding = 'base64';
            result.body = buffer.toString(encoding);
            result.bodyEncoding = encoding;
            if (query.webp) {
                result.headers['content-type'] = [{key: 'Content-Type', value: 'image/webp'}];
            }
            cb(null, result);
        })
        .catch(e => {
            // response any error
            result.status = '403';
            result.headers['content-type'] = [{key: 'Content-Type', value: 'text/plain'}];
            result.body = e.toString();
            console.error(e);
            cb(null, result);
        });
};

const parseQuery = (str: string): Query => {
    const value = (str?: string | string[]): string =>
        isArray(str) ? str[0] : str;
    const guard = (n?: number): number | null =>
        isFinite(n) && (n > 0) ? n : null;
    const parseNum = str =>
        guard(parseInt(value(str)));

    const query = querystring.parse(str);

    return {
        width: parseNum(query.w),
        height: parseNum(query.h),
        webp: Boolean(query.webp)
    };
};
