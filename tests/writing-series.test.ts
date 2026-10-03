import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureContent } from './fixtures.ts';
import { renderWritingItems, renderDynamic } from '../src/lib/html.ts';
import { publishedPosts } from '../src/lib/content.ts';
import { sortPosts } from '../src/lib/listing.ts';

test('writing items show all series names with independent escaped links and no sequence numbers', () => {
 const content = fixtureContent(), post = content.posts[0];
 content.series['second-series'] = {name:'AI & <개인 프로젝트>',description:'',posts:[post.data.id]};
 const html=renderWritingItems([post],content);
 assert.match(html, /class="post-series"/);
 assert.match(html, /href="\/series\/sample-series\/">샘플 시리즈<\/a>/);
 assert.match(html, /href="\/series\/second-series\/">AI &amp; &lt;개인 프로젝트&gt;<\/a>/);
 assert.doesNotMatch(html, /2편|1편/);
 assert.ok(html.indexOf(post.data.description)<html.indexOf('class="post-series"'));
 assert.ok(html.indexOf('class="post-series"')<html.indexOf('class="post-dates"'));
});
test('series row is omitted when not a member; private-only series do not appear', () => {
 const content=fixtureContent();content.series={hidden:{name:'숨겨진 시리즈',description:'',posts:[content.posts[2].data.id,content.posts[3].data.id]}};
 assert.doesNotMatch(renderWritingItems(publishedPosts(content),content), /post-series|숨겨진 시리즈/);
});
test('latest, oldest, category and page dynamic lists reuse membership output', () => {
 const content=fixtureContent(), posts=publishedPosts(content);
 for(const order of ['latest','oldest'] as const) assert.match(renderWritingItems(sortPosts(posts,order),content),/post-series/);
 const category=renderWritingItems(posts,content,'sample');
 assert.match(category,/\?category=sample/);assert.match(category,/href="\/series\/sample-series\/"/);
 for(const kind of ['recent-writing','writing-list','series-writing'] as const) assert.match(renderDynamic(kind,content,5,'sample-series'),/post-series/);
});
