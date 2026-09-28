# Understanding Transformer Attention and Key-Value Caching

Self-attention allows tokens in a sequence to dynamically attend to all other tokens.
Each input embedding is projected into Query, Key, and Value vectors via learned linear transformations.
The attention weight between tokens is computed as the scaled dot-product of queries and keys:
Attention(Q, K, V) = softmax(Q * K^T / sqrt(d_k)) * V.
This enables the network to capture long-range contextual relationships without recurrent bottlenecking.

## Key-Value Caching in Autoregressive Generation

During autoregressive generation, language models predict tokens one at a time sequentially.
Computing full attention at each step would redundantly recompute Key and Value matrices for all past tokens.
The Key-Value (KV) cache stores previously computed Key and Value tensors in GPU memory.
At each generation step, only the new token's Query, Key, and Value vectors are computed.
The new Key and Value are appended to the existing KV cache, dramatically reducing decoding time from O(N^2) to O(N).

## Memory Trade-offs: Multi-Query and Grouped-Query Attention

While KV caching accelerates token generation, it consumes substantial high-bandwidth GPU memory (HBM).
For long context windows and large batch sizes, KV cache memory footprint often exceeds model weights.
Multi-Query Attention (MQA) addresses this by sharing a single Key and Value head across all Query heads.
Grouped-Query Attention (GQA) provides a middle ground by partitioning Query heads into groups that share KV heads.
GQA retains virtually all model performance while achieving significant memory and latency savings.
