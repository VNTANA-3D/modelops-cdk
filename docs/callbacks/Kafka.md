# Kafka

Debugs the value of a variable or a string by printing it to `stdout`.

## Example

```yaml
- module: Kafka
  props:
    topic: model-ops-update
    typeId: com.vntana.asset.queue.message.generation.request.update.ResourceGenerationUpdateActionQueueMessage
    message:
      status: STARTED
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| topic | `string` | Kafka topic | `true` |  |
| typeId | `string` | Kafka type id | `true` |  |
| key | `string` | Kafka message key | `true` | `a05ee735-229b-4ada-b3d1-f5a13c57946d` |
| message | `Record<string, any>` | Kafka message object | `true` |  |
| error | `string` | Error path where the error message should be added to the Kafka message | `true` |  |
