package flux.v1;

input GetUserInput {
  id: ID!
}

input WatchUserInput {
  id: ID!
}

input HeartbeatInput {
  clientId: String!
}

type Post {
  id: ID!
  title: String!
  body: String!
}

type User {
  id: ID!
  name: String!
  email: String @auth(role: "admin")
  posts: [Post!]! @cost(10)
}

service UserService {
  rpc GetUser(GetUserInput) -> User
    @idempotent @cache(maxAge: 60)

  rpc WatchUser(WatchUserInput) -> stream User
    @transport(prefer: "webtransport")

  rpc Heartbeat(HeartbeatInput) -> HeartbeatInput
    @datagram
}
