# JSONPlaceholder — intent for a service we did not build

The service under test is https://jsonplaceholder.typicode.com, a public fake REST API for
prototyping. Writes are simulated: a created post is returned with a new id but not persisted.
Posts live at /posts/{id}; a post's comments at /posts/{id}/comments. No authentication.

## Fetching an existing post
<!-- peira: id=jp-post-fetch kind=ac -->
GET /posts/1 returns 200 with id 1, a numeric userId, and non-empty string title and body.

## Fetching an unknown post
<!-- peira: id=jp-post-unknown kind=ac -->
GET /posts/999999 returns 404 with an empty JSON object body.

## Comments reference their post
<!-- peira: id=jp-comments-reference kind=ac -->
GET /posts/1/comments returns 200 with a JSON array in which every element has postId 1,
a numeric id, and a string email. (An "every element" shape claim — assert it with a body
schema, not by enumerating elements.)

## Creating a post echoes the submission
<!-- peira: id=jp-create-echo kind=ac -->
POST /posts with a JSON body containing a string title, a string body, and a numeric userId
returns 201, echoing the submitted fields back together with a newly assigned numeric id.

## The posts collection is consistently shaped
<!-- peira: id=jp-collection-shape kind=ac -->
GET /posts returns 200 with a JSON array in which every element has a numeric id, a numeric
userId, and a string title. (Again a shape claim over every element — use a body schema.)
