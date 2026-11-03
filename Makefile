.PHONY: setup data demo serve dist deploy

setup:
	uv venv -q --python 3.12 .venv
	uv pip install -q --python .venv/bin/python numpy scipy
	mkdir -p pipeline/geonames
	cd pipeline/geonames && curl -sSLO https://download.geonames.org/export/dump/cities15000.zip && unzip -oq cities15000.zip && curl -sSLO https://download.geonames.org/export/dump/countryInfo.txt

data:
	.venv/bin/python -I pipeline/build.py Timeline.json web/data
	.venv/bin/python -I pipeline/enrich.py web/data/data.json 400

build-only:
	.venv/bin/python -I pipeline/build.py Timeline.json web/data

serve:
	@echo "open http://localhost:8765"
	python3 -m http.server 8765 -d web

# a completely made-up person (Chicago -> Brooklyn -> Seattle), no network needed beyond setup
demo:
	mkdir -p examples/out
	.venv/bin/python -I examples/fake_timeline.py examples/out/Timeline.json examples/out/nominatim.json
	.venv/bin/python -I pipeline/build.py examples/out/Timeline.json web/demo
	.venv/bin/python -I pipeline/enrich.py web/demo/data.json 400 --cache examples/out/nominatim.json --names none --offline

# Cloudflare: the site lives under /long-exposure/, and personal data never ships
dist:
	rm -rf dist && mkdir -p dist/long-exposure
	rsync -a --exclude data/ web/ dist/long-exposure/
	test ! -e dist/long-exposure/data

deploy: dist
	npx wrangler deploy
