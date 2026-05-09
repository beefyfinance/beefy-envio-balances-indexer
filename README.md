# Beefy Finance Balance Indexer

A HyperIndex indexer that tracks ERC20 token balances across multiple blockchain networks for Beefy Finance protocols.

## Migration from TheGraph Subgraph

This indexer was migrated from a TheGraph subgraph to Envio HyperIndex. Key changes include:

### Schema Changes
- Converted GraphQL schema from TheGraph format to HyperIndex format
- Removed `@entity` decorators and `@derivedFrom` relationships
- Added `BalanceSnapshot` entity to enable time-travel queries (since HyperIndex doesn't natively support them)
- Used `_id` fields for entity relationships instead of direct object references

### Architecture Changes
- **Dynamic Contract Discovery**: TheGraph subgraphs used templates to dynamically track new ERC20 contracts. HyperIndex requires static contract configuration, so tokens must be added to `config.yaml` explicitly.
- **Balance Snapshots**: Created `BalanceSnapshot` entities for each transfer to enable historical balance queries at specific block numbers.
- **TypeScript Implementation**: Converted from AssemblyScript to TypeScript event handlers.

### Key Features
- **Multi-chain Support**: Tracks balances across multiple EVM chains
- **Factory Contract Tracking**: Monitors Beefy vault and boost factories for new contract deployments
- **Ignored Contracts**: Supports ignoring specific contracts to handle non-standard ERC20 behaviors
- **Balance History**: Maintains complete balance history via snapshots
- **Token Statistics**: Tracks total supply and holder counts

## Configuration

### Networks Supported
Currently configured for Base network with plans to expand to:
- Ethereum Mainnet
- BSC (Binance Smart Chain)
- Polygon
- Arbitrum
- Optimism
- And other EVM-compatible chains

### Contract Types Tracked
1. **Factory Contracts**: Create new vaults and boost contracts
   - ClmManagerFactory
   - ClassicVaultFactory
   - ClassicBoostFactory
   - RewardPoolFactory

2. **ERC20 Tokens**: Track transfer events and balance changes
   - Configurable list of token addresses
   - Automatic token discovery through factory events

3. **Contract Deployers**: Track contract deployments

## Development

### Prerequisites
- Node.js v20
- pnpm package manager
- Docker (for running the indexer)

### Commands
```bash
# Generate types from schema and config
pnpm codegen

# Type check
pnpm tsc --noEmit

# Run indexer (requires Docker)
ENVIO_TUI=false pnpm dev

# Run tests
pnpm test
```

### Schema Entities

#### Core Entities
- `Token`: ERC20 token information (symbol, name, decimals)
- `Account`: Wallet or contract addresses
- `TokenBalance`: Current balance of each token for each account
- `TokenStatistic`: Aggregate statistics (total supply, holder count)

#### Balance Tracking
- `BalanceSnapshot`: Historical balance records for time-travel queries
- `Contract`: Contract discovery tracking
- `IgnoredContract`: Contracts to ignore for balance calculations

## Migration Notes

### From TheGraph to HyperIndex

1. **Static vs Dynamic Configuration**: Unlike TheGraph's dynamic templates, all contracts must be predefined in `config.yaml`. This means new tokens need to be added manually.

2. **Entity Relationships**: HyperIndex uses `_id` fields instead of direct entity references. For example:
   ```typescript
   // TheGraph style
   tokenBalance.token = token.id
   
   // HyperIndex style  
   tokenBalance.token_id = token.id
   ```

3. **Balance Snapshots**: Since HyperIndex doesn't support time-travel queries, we create a `BalanceSnapshot` for every transfer event to maintain historical data.

4. **BigInt Handling**: Careful handling of BigInt arithmetic to ensure type safety.

5. **Preload Handlers**: With `preload_handlers: true`, handlers run twice. External calls must use the Effect API.

## Deployment Considerations

- **Token Configuration**: New important tokens must be added to `config.yaml` manually
- **Start Blocks**: Each network has optimized start blocks to reduce indexing time
- **Historical Data**: Balance snapshots provide complete historical balance data
- **Performance**: Multichain indexing with optimizations for real-time processing