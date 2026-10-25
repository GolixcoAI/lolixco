import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from server.recsys.api import create_app
from server.recsys.catalog import Catalog
from server.recsys.export_catalog import check_catalog_drift, get_repo_root, sync_catalog
from server.recsys.types import EditItem
from server.recsys.similarity import compute_tag_idf, tag_idf_similarity


class TestPublicChannelMetadata(unittest.TestCase):
    def setUp(self):
        self.demo = json.loads((get_repo_root() / 'server/recsys/catalog_snapshot.json').read_text())['edits']
        self.record = dict(self.demo[0], id=100, category='Anime', sourceType='youtube_embed', format='video',
                           youtubeVideoId='12345678901', source='https://www.youtube.com/watch?v=12345678901',
                           poster='https://i.ytimg.com/vi/12345678901/hqdefault.jpg', channelTitle='Fixture creator',
                           channelId='UC_FIXTURE_CREATOR', sourceUrl='https://www.youtube.com/watch?v=12345678901')

    def drift(self, live, snapshot):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            path.write_text(json.dumps({'catalog_version':'demo-catalog-v1','total_edits':len(snapshot),'edits':snapshot}))
            with patch('server.recsys.export_catalog.fetch_edits_from_source', return_value=live):
                return check_catalog_drift(get_repo_root(), path)

    def test_optional_channel_fields_load_without_inventing_demo_metadata(self):
        catalog = Catalog.from_dict_list(self.demo + [self.record])
        self.assertEqual(catalog.get(100).channel_title, 'Fixture creator')
        self.assertEqual(catalog.get(100).source_url, self.record['sourceUrl'])
        self.assertIsNone(catalog.get(0).channel_title)
        self.assertIsNone(catalog.get(0).channel_id)
        self.assertIsNone(catalog.get(0).source_url)

    def test_optional_field_presence_absence_and_changes_are_compared(self):
        live = self.demo + [self.record]
        self.assertTrue(self.drift(live, live)[0])
        for field in ('channelTitle','channelId','sourceUrl'):
            for action in ('missing','changed','null','wrong-type'):
                with self.subTest(field=field, action=action):
                    snapshot = copy.deepcopy(live)
                    if action == 'missing': del snapshot[-1][field]
                    elif action == 'null': snapshot[-1][field] = None
                    elif action == 'wrong-type': snapshot[-1][field] = 12
                    else: snapshot[-1][field] = snapshot[-1][field] + 'changed'
                    self.assertFalse(self.drift(live,snapshot)[0])
                    self.assertFalse(self.drift(snapshot,live)[0])

    def test_bad_types_private_fields_and_credential_source_urls_fail(self):
        for field,value in [('channelTitle',12),('channelId',False),('sourceUrl','https://user:pass@youtube.com/watch?v=12345678901'),('sourceUrl','https://www.youtube.com/watch?v=abcdefghijk'),('s3MasterArchiveKey','private')]:
            with self.subTest(field=field):
                with self.assertRaises((TypeError,ValueError)):
                    Catalog.from_dict_list([dict(self.record, **{field:value})])

    def test_demo_and_hosted_items_do_not_accept_youtube_only_metadata(self):
        for source in ('local_demo','licensed_local_media'):
            with self.subTest(source=source):
                with self.assertRaises(ValueError): Catalog.from_dict_list([dict(self.record,sourceType=source)])

    def test_api_retains_optional_channel_metadata(self):
        client = TestClient(create_app(catalog=Catalog.from_dict_list(self.demo+[self.record])))
        response = client.post('/api/v1/recommendations',json={'surface':'up_next','current_edit_id':0,'limit':30})
        self.assertEqual(response.status_code,200)
        record = next(item['edit'] for item in response.json()['items'] if item['edit_id']==100)
        self.assertEqual(record['channelTitle'],self.record['channelTitle'])
        self.assertEqual(record['channelId'],self.record['channelId'])
        self.assertEqual(record['sourceUrl'],self.record['sourceUrl'])

    def test_metadata_does_not_change_weighted_jaccard(self):
        before = Catalog.from_dict_list(self.demo)
        edited = copy.deepcopy(self.demo)
        edited[0].update({key:value for key,value in self.record.items() if key in ('sourceType','youtubeVideoId','channelTitle','channelId','sourceUrl')})
        after = Catalog.from_dict_list(edited)
        idf = compute_tag_idf(before)
        self.assertEqual(idf,compute_tag_idf(after))
        self.assertEqual(tag_idf_similarity(before.get(0).tags,before.get(1).tags,idf),tag_idf_similarity(after.get(0).tags,after.get(1).tags,idf))

    def test_exporter_cannot_independently_write_production_snapshot(self):
        for path in ('server/recsys/catalog_snapshot.json', 'src/data/edits.ts', 'content/baseline/edits.ts', 'content/audit/blocked.json'):
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError,'paired publication'):
                    sync_catalog(get_repo_root(),get_repo_root()/path)

    def test_dataclass_rejects_invalid_optional_types(self):
        item = Catalog.from_dict_list([self.record]).get(100)
        from dataclasses import replace
        with self.assertRaises(TypeError): replace(item,channel_title=7)


if __name__ == '__main__': unittest.main()
