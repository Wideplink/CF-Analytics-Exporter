# CF Analytics Exporter

This project is to export analytics data from [Cloudflare](https://cloudflare.com/) to [Influxdb](https://www.influxdata.com/).

## What is this?

Peridically, this exporter collects analytics data from [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/) and exports to Influxdb.  
You can use dashboard in Influxdb or [Grafana](https://grafana.com/) to visualize the data.

## How to use

1. Create a Cloudflare API Token. [Follow this instruction](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).  
The token should have permissions below:
    - Account Analytics:Read
    - Account Settings:Read
    - Zone Analytics:Read

2. Create a Influxdb database and token.
3. Copy `.env.example` to `.env` and edit it.
4. Run `yarn install --immutable` to install dependencies.
5. Run `yarn start` to start the exporter.
