/**
 * Safe starter template for a macOS `/etc/resolver/<domain>` file.
 *
 * Every directive documented by `resolver(5)` is represented, but all
 * example values stay commented out so creating a resolver never routes
 * DNS traffic to a placeholder server before the user reviews it.
 */
export const RESOLVER_TEMPLATE = `# nameserver: DNS server IPv4/IPv6 address. Up to 3 entries, queried in order.
# An individual server may append a port, for example 192.0.2.53.5353.
# nameserver 192.0.2.53
# nameserver 2001:db8::53

# port: Default DNS port for this resolver. A nameserver-specific port overrides it.
# port 53

# domain: Domain handled by this resolver. Usually omitted because the file name is used.
# domain internal.example

# search: Search domains for unqualified host names. Maximum 6 domains / 256 characters.
# search internal.example corp.example

# search_order: Priority when multiple resolver clients handle the same domain; lower runs first.
# search_order 100

# sortlist: Preferred order for returned IPv4 networks, written as address[/netmask] pairs.
# sortlist 192.0.2.0/255.255.255.0 198.51.100.0

# timeout: Total seconds allowed for one name-resolution operation.
# timeout 5

# options: Resolver flags. Supported values are:
#   debug      - enable resolver debug logging
#   timeout:n  - per-retry timeout (ignored when the timeout directive above is set)
#   ndots:n    - dots required before trying a name as absolute; default is 1
# options timeout:2 ndots:1
`
