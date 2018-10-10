THREE.ParticleSystem = function( source, options ){

    options = options || {};

    this.GUI;

    this.ACTIVE_PARTICLE = 0;

    this.TIME = 0;
    this.TIME_SCALE = options.timeScale !== undefined ? options.timeScale : 1;

    this.MAX_PARTICLES = options.maxParticles !== undefined ? options.maxParticles : 10000;
    this.SPAWN_RATE = options.spawnRate !== undefined ? options.spawnRate : 100;
    this.rateCounter = 0;

    this.SPAWN_EMITFROM = "face"; //origin, vert, face, volume
    this.SPAWN_ELDISTRIB = "random"; //index, random
    this.SPAWN_INDEX = 0;
    this.SPAWN_EMDISTRIB =  "random"; //centre, random(WIP) //grid(future job)//
    this.GRID_RESOLUTION = 1;

    this.SIZE = options.size !== undefined ? options.size : 5;
    this.VAR_SIZE = options.varySize !== undefined ? options.varySize : 0;

    this.LIFETIME = options.lifetime !== undefined ? options.lifetime : 5;
    this.VAR_LIFETIME = options.varyLifetime !== undefined ? options.varyLifetime : 0;

    this.INIT_POS = this.opt_FloatToVec( options.initPosition !== undefined ? options.initPosition : 0 );
    this.VAR_POS = this.opt_FloatToVec( options.varyPosition !== undefined ? options.varyPosition : 0 );

    this.INIT_VEL = this.opt_FloatToVec( options.initVelocity !== undefined ? options.initVelocity : new THREE.Vector3( 0, 0, 0 ) );
    this.NORM_VEL = options.normalVelocity !== undefined ? options.normalVelocity : 1;
    this.VAR_VEL = this.opt_FloatToVec( options.varyVelocity !== undefined ? options.varyVelocity : 0 );

    this.INIT_COL = this.opt_FloatToQuat( options.initColour !== undefined ? options.initColour : 1 );
    this.VAR_COL = this.opt_FloatToQuat( options.varyColour !== undefined ? options.varyColour : 0 );

    this.Updated = new Array( this._softParticleLimit ).fill( false );

    this.VERTEX_SHADER = `
        attribute float size;
        attribute vec4 colour;
        attribute float birthTime;
        attribute float lifetime;
        attribute vec3 birthPos;
        attribute vec3 velocity;

        uniform float uTime;
        uniform bool attenSize;

        varying vec4 vColour;

        void main() {

            vColour = colour;

            float age = uTime - birthTime ;

            if( age >= 0. && age < lifetime ){

                vec3 newPosition = birthPos + velocity * age;

                vec4 mvPosition = modelViewMatrix * vec4( newPosition, 1.0 );

                gl_PointSize = size;

                if( attenSize ){

                    if( projectionMatrix[2][3] == -1.0 ) gl_PointSize *= 20.0 / -mvPosition.z; //SIZE ATTENUATION

                }

                gl_Position = projectionMatrix * mvPosition;

            } else{

                gl_PointSize = 0.;

            }

        }
    `;

    this.FRAG_SHADER = `
        varying vec4 vColour;

        void main() {

            gl_FragColor = vec4( vColour );

        }
    `;

    THREE.Object3D.apply( this, arguments );

    this.source = source;
    this.source.material.side = THREE.DoubleSide; //REQUIRED FOR RAYCASTING DURING SPAWN
    this.source.geometry.computeBoundingBox();
    this.source.add( this );

    this.raycaster = new THREE.Raycaster();

    this.showOptions = options.showOptions !== undefined ? options.showOptions : false;

    this.init();

}

THREE.ParticleSystem.prototype = Object.create( THREE.Object3D.prototype );
THREE.ParticleSystem.prototype.constructor = THREE.ParticleSystem;

Object.assign( THREE.ParticleSystem.prototype, {

    init: function(){

        if( this.points ){ console.warn( "System already initialised!" ); return };
        this.points = new THREE.Points();
        this.add( this.points );

        this.refreshGeo();
        this.refreshMaterial();

    },

    calcSpawnPoint: function( position, velocity ){

        //Position
        let sourceIndex;
        let source;
        let index;
        let normal = new THREE.Vector3();

        switch( this.SPAWN_ELDISTRIB ){

            case "index":

                sourceIndex = pool => this.SPAWN_INDEX >= pool.length ? pool.length - 1 : this.SPAWN_INDEX;
                break;

            case "random":

                sourceIndex = pool => THREE.Math.randInt( 0, pool.length - 1 );
                break;

        }

        switch( this.SPAWN_EMITFROM ){

            case "origin":


                source = this.source.position;
                normal = this.source.up;
                position.add( source );
                break;

            case "vert":

                index = sourceIndex( this.source.geometry.vertices )

                source = this.source.geometry.vertices[ index ];
                normal = this.source.geometry.faces.map( face => face.vertexNormals[ Object.values( face ).indexOf( index ) ] ).filter( el => el )[0];
                position.add( source );

                break;

            case "face":

                index = sourceIndex( this.source.geometry.faces )

                normal = this.source.geometry.faces[ index ].normal;
                source = this.find3DPos( Object.values( this.source.geometry.faces[ index ] ).slice( 0, 3 ).map( vert => this.source.geometry.vertices[ vert ] ), normal.clone() );
                position.add( source );

                break;

            case "volume":

                normal = this.source.up;
                source = this.find3DPos( this.source.geometry.vertices, normal.clone() );
                position.add( source );
                break;

        }



        return [ position, normal ]

    },

    find3DPos: function( source, normal ){

        let pos = new THREE.Vector3();

        switch( this.SPAWN_EMDISTRIB ){

            case "centre":

                pos.x = source.reduce( ( acc, vert ) => acc + vert.x, 0)/source.length;
                pos.y = source.reduce( ( acc, vert ) => acc + vert.y, 0)/source.length;
                pos.z = source.reduce( ( acc, vert ) => acc + vert.z, 0)/source.length;

                break;

            case "random":

                let genPos;

                switch( this.SPAWN_EMITFROM ){

                    case "face":

                        genPos = () => new THREE.Vector3().subVectors( source[1], source[0] ).multiplyScalar( Math.random() ).add( new THREE.Vector3().subVectors( source[2], source[0] ).multiplyScalar( Math.random() ) ).add( source[0] );

                        break;

                    case "volume":

                        genPos = () => {

                            const tmp = new THREE.Vector3().subVectors( this.source.geometry.boundingBox.max, this.source.geometry.boundingBox.min )
                            tmp.x = tmp.x * Math.random();
                            tmp.y = tmp.y * Math.random();
                            tmp.z = tmp.z * Math.random();

                            return tmp.add( this.source.geometry.boundingBox.min );

                        };

                        break;

                }

                pos = genPos();
                this.raycaster.set( pos, normal.clone().negate() );

                while( this.raycaster.intersectObject( this.source ).length === 0 ) {

                    pos = genPos();
                    this.raycaster.set( pos, normal.clone().negate() );

                }

                break;

        }

        return pos

    },

    opt_FloatToVec: function( value ){

        let option;

        if( value instanceof THREE.Vector3 ){
            option = value;
        } else{
            option = new THREE.Vector3( value, value, value );
        }

        return option


    },

    opt_FloatToQuat: function( value ){

        let option;

        if( value instanceof THREE.Quaternion ){
            option = value;
        } else{
            option = new THREE.Quaternion( value, value, value, value );
        }

        return option


    },

    refreshGeo: function(){

        this.ACTIVE_PARTICLE = 0;
        this.rateCounter = 0;
        this.TIME = 0;


        const particleGeo = new THREE.BufferGeometry();

        particleGeo.addAttribute( 'position',   new THREE.BufferAttribute( new Float32Array( this._softParticleLimit * 3 ), 3 ).setDynamic( true ) );
        particleGeo.addAttribute( 'birthPos',   new THREE.BufferAttribute( new Float32Array( this._softParticleLimit * 3 ), 3 ).setDynamic( true ) );
        particleGeo.addAttribute( 'birthTime',  new THREE.BufferAttribute( new Float32Array( this._softParticleLimit ), 1 ).setDynamic( true ) );
        particleGeo.addAttribute( 'velocity',   new THREE.BufferAttribute( new Float32Array( this._softParticleLimit * 3 ), 3 ).setDynamic( true ) );
        particleGeo.addAttribute( 'colour',      new THREE.BufferAttribute( new Float32Array( this._softParticleLimit * 4 ), 4 ).setDynamic( true ) );
        particleGeo.addAttribute( 'size',       new THREE.BufferAttribute( new Float32Array( this._softParticleLimit ), 1 ).setDynamic( true ) );
        particleGeo.addAttribute( 'lifetime',   new THREE.BufferAttribute( new Float32Array( this._softParticleLimit ), 1 ).setDynamic( true ) );

        this.points.geometry && this.points.geometry.dispose();
        this.points.geometry = particleGeo;

    },

    refreshMaterial: function(){

        this.points.material && this.points.material.dispose();

        this.points.material =  new THREE.ShaderMaterial( {

                                    vertexShader: this.VERTEX_SHADER,
                                    fragmentShader: this.FRAG_SHADER,
                                    uniforms: {
                                        'uTime': {
                                            value: 0.0
                                        },
                                        'attenSize': {
                                            value: true
                                        }
                                    },
                                    blending: THREE.AdditiveBlending,
                                    transparent: true,

                                });

    },

    spawnParticle: function(){

        const i = this.ACTIVE_PARTICLE;

        const birthPosAttribute =   this.points.geometry.getAttribute( 'birthPos' );
        const birthTimeAttribute =  this.points.geometry.getAttribute( 'birthTime' );
        const velocityAttribute =   this.points.geometry.getAttribute( 'velocity' );
        const colourAttribute =     this.points.geometry.getAttribute( 'colour' );
        const sizeAttribute =       this.points.geometry.getAttribute( 'size' );
        const lifetimeAttribute =   this.points.geometry.getAttribute( 'lifetime' );

        const colour = this.INIT_COL.clone();

        let [ position, normal ] = this.calcSpawnPoint( this.INIT_POS.clone() );

        birthPosAttribute.array[ i * 3     ] = position.x + this.VAR_POS.x * THREE.Math.randFloat( -1, 1 );
        birthPosAttribute.array[ i * 3 + 1 ] = position.y + this.VAR_POS.y * THREE.Math.randFloat( -1, 1 );
        birthPosAttribute.array[ i * 3 + 2 ] = position.z + this.VAR_POS.z * THREE.Math.randFloat( -1, 1 );


        //Velocity
        velocityAttribute.array[ i * 3     ] = this.INIT_VEL.x + this.NORM_VEL * normal.x + this.VAR_VEL.x * THREE.Math.randFloat( -1, 1 );
        velocityAttribute.array[ i * 3 + 1 ] = this.INIT_VEL.y + this.NORM_VEL * normal.y + this.VAR_VEL.y * THREE.Math.randFloat( -1, 1 );
        velocityAttribute.array[ i * 3 + 2 ] = this.INIT_VEL.z + this.NORM_VEL * normal.z + this.VAR_VEL.z * THREE.Math.randFloat( -1, 1 );


        //Colour
        colour.x = THREE.Math.clamp( colour.x + this.VAR_COL.x * THREE.Math.randFloat( -1, 1 ), 0, 1 );
        colour.y = THREE.Math.clamp( colour.y + this.VAR_COL.y * THREE.Math.randFloat( -1, 1 ), 0, 1 );
        colour.z = THREE.Math.clamp( colour.z + this.VAR_COL.z * THREE.Math.randFloat( -1, 1 ), 0, 1 );
        colour.w = THREE.Math.clamp( colour.w + this.VAR_COL.w * THREE.Math.randFloat( -1, 1 ), 0, 1 );

        colourAttribute.array[ i * 4     ] = colour.x;
        colourAttribute.array[ i * 4 + 1 ] = colour.y;
        colourAttribute.array[ i * 4 + 2 ] = colour.z;
        colourAttribute.array[ i * 4 + 3 ] = colour.w;

        // size, lifetime and starttime
        sizeAttribute.array[ i ] = this.SIZE + THREE.Math.randFloat( -1, 1 ) * this.VAR_SIZE;
        lifetimeAttribute.array[ i ] = this.LIFETIME + THREE.Math.randFloat( -1, 1 ) * this.VAR_LIFETIME;
        birthTimeAttribute.array[ i ] = this.TIME;

        this.Updated[ i ] = true;

        this.ACTIVE_PARTICLE = this.ACTIVE_PARTICLE >= this._softParticleLimit ? 0 : this.ACTIVE_PARTICLE + 1;


    },

    updateGeo: function(){

        let offset = this.Updated.indexOf( true );
        offset = offset === -1 ? 0 : offset;
        const count = this.Updated.length - this.Updated.lastIndexOf( true );

        ['birthPos', 'birthTime', 'velocity', 'colour', 'size', 'lifetime'].forEach( attrName => {

            const attr = this.points.geometry.getAttribute( attrName );

            attr.updateRange.count = count * attr.itemSize;
            attr.updateRange.offset = offset * attr.itemSize;

            attr.needsUpdate = true;

        })

    },

    update: function(){

        const delta = clock.getDelta() * this.TIME_SCALE;

        this.TIME += delta;

        if( this.TIME < 0 ) this.TIME = 0;

        if ( delta > 0 && this.TIME > this.rateCounter/this.SPAWN_RATE ) {

            for( let i = 0; i < this.SPAWN_RATE*delta; i++){

                this.rateCounter++;
                this.spawnParticle();

            }

        }

        this.updateGeo();
        this.Updated = this.Updated ? this.Updated.fill( false ) : new Array( this._softParticleLimit ).fill( false );
        this.points.material.uniforms.uTime.value = this.TIME;

    },

    dispose: function () {

		this.points.dispose();

	},

    buildOptions: function(){

        let gui = new dat.GUI();
        this.GUI = gui;

        const assertNumericController = ( parent, name, toShow, rangeFrom, rangeTo ) => {
            cont = parent.__controllers.filter( cont => cont.property === name )[0];
            cont && cont.remove();
            if ( toShow ){
                parent.add( this, name, rangeFrom, rangeTo , 1 );
            }
        };

        const assertStringController = ( parent, name, toShow, range ) => {
            cont = parent.__controllers.filter( cont => cont.property === name )[0];
            cont && cont.remove();
            if ( toShow ){
                parent.add( this, name, range );
            }
        };

        const addVectorProp = ( parent, name, property, rangeFrom, rangeTo ) => {

            let cont = parent.addFolder( name );
            cont.add( property, "x", rangeFrom, rangeTo, 0.1 );
            cont.add( property, "y", rangeFrom, rangeTo, 0.1 );
            cont.add( property, "z", rangeFrom, rangeTo, 0.1 );
            property instanceof THREE.Quaternion &&  cont.add( property, "w", rangeFrom, rangeTo, 0.1 );

        };

        //////Emitter Settings//////
        let emitter = gui.addFolder( "Emitter" );
        emitter.add( this, "spawnRate", 0, 500, 10 );

        let source = emitter.addFolder( "Source" );
        const assertEmitIndex = () => assertNumericController( source, "emitIndex", ["vert","face"].includes( this.emitFrom ) && this.elementDistribution === "index", 0, ( this.emitFrom === "vert" ? this.source.geometry.vertices.length : this.source.geometry.faces.length ) - 1 );
        const assertEmitDistribution = () => assertStringController( source, "emitDistribution", ["face","volume"].includes( this.emitFrom ), { Centre: "centre", "Random(WIP)": "random", "//Grid": "grid" } );

        source.add( this, "emitFrom", { Centre: "origin", Vertex: "vert", Face: "face", Volume: "volume" } ).onChange( () => {assertEmitIndex(); assertEmitDistribution()} );
        source.add( this, "elementDistribution", { Index: "index", Random: "random" } ).onChange( () => {assertEmitIndex(); assertEmitDistribution()} );
        assertEmitIndex();
        assertEmitDistribution();

        //////Particle Settings//////
        let particle = gui.addFolder( "Particle" );

        let lifetime = particle.addFolder( "Lifetime" );
        lifetime.add( this, "lifetime", 0, 10, 0.1 );
        lifetime.add( this, "varyLifetime", 0, 10, 0.1 );

        let size = particle.addFolder( "Size" );
        size.add( this, "size", 1, 20, 1 );
        size.add( this, "varySize", 0, 20, 1 );

        let position = particle.addFolder( "Position" );
        addVectorProp( position, "Initial", this.initPosition, -5, 5 );
        addVectorProp( position, "Variance", this.varyPosition, 0 ,5 );
        let velocity = particle.addFolder( "Velocity" );
        velocity.add( this, "normalVelocity", -5, 5, 0.1 );
        addVectorProp( velocity, "Initial", this.initVelocity, -5, 5 );
        addVectorProp( velocity, "Variance", this.varyVelocity, 0, 5 );
        let color = particle.addFolder( "Color" );
        addVectorProp( color, "Initial", this.initColour, 0, 1 );
        addVectorProp( color, "Variance", this.varyColour, 0, 1 );



    },

    removeOptions: function(){

        this.GUI.destroy();
        this.GUI = undefined;

    }


})

Object.defineProperties( THREE.ParticleSystem.prototype, {


    "showOptions": {

        get: function(){ return this.OPTIONS_PANEL },

        set: function( value ){

            this.OPTIONS_PANEL = value;

            if( this.OPTIONS_PANEL ){

                !this.GUI && this.buildOptions();

            } else{

                this.GUI && this.removeOptions();

            }

        }

    },

    "source": {

        get: function(){ return this.SOURCE },

        set: function( value ){

            value.geometry.computeVertexNormals_New( true );
            this.SOURCE = value;

        }

    },

    "vertexShader": {

        get: function(){ return this.VERTEX_SHADER },

        set: function( value ){

            this.VERTEX_SHADER = value;
            this.refreshMaterial();

        }

    },
    "sizeAttenuation": {

        get: function(){ return this.points.material.uniforms.attenSize.value },

        set: function( value ){

            this.points.material.uniforms.attenSize.value = value;

        }

    },

    "fragShader": {

        get: function(){ return this.FRAG_SHADER },

        set: function( value ){

            this.FRAG_SHADER = value;
            this.refreshMaterial();

        }

    },

    "maxParticles": {

        get: function(){ return this.MAX_PARTICLES },

        set: function( value ){

            console.warn( "New maxParticles. Rebuilding system." );
            this.MAX_PARTICLES = value;
            this.refreshGeo();

        }

    },
    "_softParticleLimit": {

       get: function(){

           let tmp = this.SPAWN_RATE * ( this.LIFETIME + this.VAR_LIFETIME );

           if( tmp > this.MAX_PARTICLES ){

               tmp = this.MAX_PARTICLES;
               console.warn( "Max number of Particles will be exceeded with current Spawn Rate and Lifetime! Capping to .maxParticles; increase to remove limit." );

           }

           return tmp

       },

       set: function( value ){ console.warn( "This value is used internally, there is nothing to set. Perhaps you meant to set .maxParticles?" ) }

    },
    "spawnRate": {

        get: function(){ return this.SPAWN_RATE },

        set: function( value ){

            this.SPAWN_RATE = value;
            this.refreshGeo();

        }

    },

    "emitFrom": {

        get: function(){ return this.SPAWN_EMITFROM },

        set: function( value ){ this.SPAWN_EMITFROM = value; }

    },
    "elementDistribution": {

       get: function(){ return this.SPAWN_ELDISTRIB },

       set: function( value ){

           this.SPAWN_ELDISTRIB = value;

           if( this.SPAWN_ELDISTRIB > ( this.SPAWN_EMITFROM === "vert" ? this.source.geometry.vertices.length : this.source.geometry.faces.length ) - 1 ) this.emitIndex = 0;

       }

    },
    "emitIndex": {

       get: function(){ return this.SPAWN_INDEX },

       set: function( value ){ this.SPAWN_INDEX = value }

    },
    "emitDistribution": {

       get: function(){ return this.SPAWN_EMDISTRIB },

       set: function( value ){ this.SPAWN_EMDISTRIB = value }

    },
    "gridResolution": {

       get: function(){ console.log( "Not yet implemented" ) },//return this.GRID_RESOLUTION },

       set: function( value ){ this.GRID_RESOLUTION = value }

    },

    "size": {

        get: function(){ return this.SIZE },

        set: function( value ){

            this.SIZE = value;

        }

    },
    "varySize": {

        get: function(){ return this.VAR_SIZE },

        set: function( value ){

            this.VAR_SIZE = value;

        }

    },

    "lifetime": {

        get: function(){ return this.LIFETIME },

        set: function( value ){

            this.LIFETIME = value;
            this.refreshGeo();

        }

    },
    "varyLifetime": {

        get: function(){ return this.VAR_LIFETIME },

        set: function( value ){

            this.VAR_LIFETIME = value;
            this.refreshGeo();

        }

    },

    "initPosition": {

        get: function(){ return this.INIT_POS },

        set: function( value ){

            this.INIT_POS = this.opt_FloatToVec( value );

        }

    },
    "varyPosition": {

        get: function(){ return this.VAR_POS },

        set: function( value ){

            this.VAR_POS = this.opt_FloatToVec( value );

        }

    },

    "normalVelocity": {

       get: function(){ return this.NORM_VEL },

       set: function( value ){ this.NORM_VEL = value }

    },
    "initVelocity": {

        get: function(){ return this.INIT_VEL },

        set: function( value ){

            this.INIT_VEL = this.opt_FloatToVec( value );

        }

    },
    "varyVelocity": {

        get: function(){ return this.VAR_VEL },

        set: function( value ){

            this.VAR_VEL = this.opt_FloatToVec( value );

        }

    },

    "initColour": {

        get: function(){ return this.INIT_COL },

        set: function( value ){

            this.INIT_COL = this.opt_FloatToVec( value );

        }

    },
    "varyColour": {

        get: function(){ return this.VAR_COL },

        set: function( value ){

            this.VAR_COL = this.opt_FloatToVec( value );

        }

    },

})

THREE.Geometry.prototype.computeVertexNormals_New = function ( areaWeighted ) {

		if ( areaWeighted === undefined ) areaWeighted = true;

		var v, vl, vA, vB, vC, f, fl, face, vertices, normal;

		vertices = new Array( this.vertices.length ).fill( 0 ).map( el => [] );

        this.faces.forEach( face => {

            if ( areaWeighted ) {

                // vertex normals weighted by triangle areas
                // http://www.iquilezles.org/www/articles/normals/normals.htm
                // cross-product of two adjacent regular polygon edges is directly proportional to polygon's area

    			var cb = new THREE.Vector3(), ab = new THREE.Vector3();

				vA = this.vertices[ face.a ];
				vB = this.vertices[ face.b ];
				vC = this.vertices[ face.c ];

				cb.subVectors( vC, vB );
				ab.subVectors( vA, vB );
				normal = cb.cross( ab );

		    } else {

    			this.computeFaceNormals();
                normal = face.normal;

            }

            //Test for planar duplicates (vectors pointing in same direction)
			!vertices[ face.a ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.a ].push( normal.clone() );
			!vertices[ face.b ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.b ].push( normal.clone() );
			!vertices[ face.c ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.c ].push( normal.clone() );

		});

        vertices = vertices.map( arr => arr.reduce( ( acc, vec ) => acc.add( vec ), new THREE.Vector3() ).normalize() );

		for ( f = 0, fl = this.faces.length; f < fl; f ++ ) {

			face = this.faces[ f ];

			var vertexNormals = face.vertexNormals;

			if ( vertexNormals.length === 3 ) {

                vertexNormals[ 0 ].copy( vertices[ face.a ] );
				vertexNormals[ 1 ].copy( vertices[ face.b ] );
				vertexNormals[ 2 ].copy( vertices[ face.c ] );

			} else {

				vertexNormals[ 0 ] = vertices[ face.a ].clone();
				vertexNormals[ 1 ] = vertices[ face.b ].clone();
				vertexNormals[ 2 ] = vertices[ face.c ].clone();

			}

		}

		if ( this.faces.length > 0 ) {

			this.normalsNeedUpdate = true;

		}

	}
