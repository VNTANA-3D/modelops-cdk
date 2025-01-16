# SQS

Send a message to an SQS queue

## Example

```yaml
# Send message.
- module: SQS
  props:
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/{{ accountId }}/{{ sqsQueueName }}'
    region: us-east-1
    message:
      jobRef: '{{ jobRef }}'
      customerId: '{{ customerId }}'
      status: 'RUNNING'
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| accessKeyId | `string` | AWS Access Key ID. | `true` |  |
| secretAccessKey | `string` | AWS Secret Access Key. | `true` |  |
| region | `string` | AWS Region. | `true` | `us-east-1` |
| queueUrl | `string` | SQS Queue URL | `false` |  |
| message | `Record<string, any>` | SQS Message Body | `false` |  |
