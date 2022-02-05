import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'

interface StaticSiteHostingStackProps extends StackProps {
  bucketName: string
  bucketRemovalPolicy: RemovalPolicy
  function?: cloudfront.Function
}

export class StaticSiteHostingStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StaticSiteHostingStackProps
  ) {
    super(scope, id, props)

    // Create Bucket
    const bucket = new s3.Bucket(this, 'S3Bucket', {
      bucketName: props.bucketName,
      // Bucketへの直接アクセスを禁止
      accessControl: s3.BucketAccessControl.PRIVATE,
      // Stackの削除時にBucketも削除するかどうか
      removalPolicy: props.bucketRemovalPolicy,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
    })

    // S3を公開状態にすることなく、S3へのアクセスを CloudFrontからのリクエストに絞る
    const identity = new cloudfront.OriginAccessIdentity(
      this,
      'OriginAccessIdentity',
    )

    // principalsに設定したアクセス元からのみに S3 バケットのGetObject権限を渡す
    const bucketPolicyStatement = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      effect: iam.Effect.ALLOW,
      principals: [identity.grantPrincipal],
      resources: [`${bucket.bucketArn}/*`],
    })

    // bucketにポリシーをアタッチ
    bucket.addToResourcePolicy(bucketPolicyStatement)

    const functionAssociations = props.function
      ? [
          {
            function: props.function,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ]
      : undefined

    // CloudFrontのdistribution作成
    new cloudfront.CloudFrontWebDistribution(this, 'WebDistribution', {
      enableIpV6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: bucket,
            originAccessIdentity: identity,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
              cachedMethods: cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD,
              forwardedValues: {
                queryString: false,
              },
              // CloudFront FunctionをDistributionに設定
              functionAssociations,
            },
          ],
        },
      ],
      // 403/404エラーはindex.htmlを表示
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 200,
          errorCachingMinTtl: 0,
          responsePagePath: '/index.html',
        },
        {
          errorCode: 404,
          responseCode: 200,
          errorCachingMinTtl: 0,
          responsePagePath: '/index.html',
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    })
  }
}
