THREE.ParticleSystem = function( source, options ){

    options = options || {};

    this.GUI;

    this.params = {

        TIME_SCALE: options.timeScale !== undefined ? options.timeScale : 1,

        //Emitter
        MAX_PARTICLES: options.maxParticles !== undefined ? options.maxParticles : 10000,
        SPAWN_RATE: options.spawnRate !== undefined ? options.spawnRate : 100,
        ANIMATE_SPAWN: false, //Less memory efficient, stops rebuilding on spawn value change

        SPAWN_EMITFROM: "face", //origin, vert, face, volume
        SPAWN_ELDISTRIB: "random", //index, random,
        SPAWN_INDEX: 0,
        SPAWN_EMDISTRIB:  "random", //centre, random(WIP) //grid(future job)//,
        GRID_RESOLUTION: 1,

        //Particles
        SIZE: options.size !== undefined ? options.size : 5,
        VAR_SIZE: options.varySize !== undefined ? options.varySize : 0,

        LIFETIME: options.lifetime !== undefined ? options.lifetime : 5,
        VAR_LIFETIME: options.varyLifetime !== undefined ? options.varyLifetime : 0,

        INIT_POS: this.opt_ToVec( options.initPosition !== undefined ? options.initPosition : 0 ),
        VAR_POS: this.opt_ToVec( options.varyPosition !== undefined ? options.varyPosition : 0 ),

        INIT_VEL: this.opt_ToVec( options.initVelocity !== undefined ? options.initVelocity : new THREE.Vector3( 0, 0, 0 ) ),
        NORM_VEL: options.normalVelocity !== undefined ? options.normalVelocity : 1,
        VAR_NORM_VEL: options.varyNormalVelocity !== undefined ? options.varyNormalVelocity : 0,
        VAR_VEL: this.opt_ToVec( options.varyVelocity !== undefined ? options.varyVelocity : 0 ),

        INIT_COL: this.opt_ToQuat( options.initColour !== undefined ? options.initColour : 1 ),
        VAR_COL: this.opt_ToQuat( options.varyColour !== undefined ? options.varyColour : 0 ),

        //Display
        DISPLAY_MODE: "shader", //shader, object, group

    }

    this.ACTIVE_PARTICLE = 0;
    this.PARTICLE_LIMIT_REACHED = false;

    this.TIME = 0;

    this._rateCounter = 0;
    this._offset = 0;
    this._count = 0;

    this.VERTEX_SHADER = `
        attribute float size;
        attribute vec4 colour;
        attribute float birthTime;
        attribute float lifetime;
        attribute vec3 offset;
        attribute vec3 velocity;

        uniform float uTime;
        uniform bool attenSize;

        varying vec4 vColour;
        varying vec2 vUv;

        void main() {

            vColour = colour;
            vUv = uv;

            float age = uTime - birthTime ;

            if( age >= 0. && age < lifetime ){

                vec3 newPosition = offset + velocity * age + position;

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
        varying vec2 vUv;

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

    init: function( overwrite ){

        if( this.points && !overwrite ){ console.warn( "System already initialised! Use .init( true ) to overwrite." ); return };

        this.remove( this.points );
        this.points = this.params.DISPLAY_MODE === "object" ? new THREE.Mesh() : new THREE.Points();
        this.add( this.points );

        this.refreshGeo();
        this.refreshMaterial();

    },

    calcOffset: function( position, velocity ){

        //Position
        let sourceIndex;
        let source;
        let index;
        let normal = new THREE.Vector3();

        switch( this.params.SPAWN_ELDISTRIB ){

            case "index":

                sourceIndex = pool => this.params.SPAWN_INDEX >= pool.length ? pool.length - 1 : this.params.SPAWN_INDEX;
                break;

            case "random":

                sourceIndex = pool => THREE.Math.randInt( 0, pool.length - 1 );
                break;

        }

        switch( this.params.SPAWN_EMITFROM ){

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

        switch( this.params.SPAWN_EMDISTRIB ){

            case "centre":

                pos.x = source.reduce( ( acc, vert ) => acc + vert.x, 0)/source.length;
                pos.y = source.reduce( ( acc, vert ) => acc + vert.y, 0)/source.length;
                pos.z = source.reduce( ( acc, vert ) => acc + vert.z, 0)/source.length;

                break;

            case "random":

                let genPos;

                switch( this.params.SPAWN_EMITFROM ){

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

    opt_ToVec: function( value ){

        let option;

        if( value instanceof THREE.Vector3 ){
            option = value;
        } else if( value instanceof Object ){
            option = new THREE.Vector3( value.x, value.y, value.z );
        } else{
            option = new THREE.Vector3( value, value, value );
        }

        return option


    },

    opt_ToQuat: function( value ){

        let option;

        if( value instanceof THREE.Quaternion ){
            option = value;
        } else if( value instanceof Object ){
            option = new THREE.Quaternion( value.x || value.r, value.y || value.g, value.z || value.b, value.w || value.a );
        } else{
            option = new THREE.Quaternion( value, value, value, value );
        }

        return option


    },

    refreshGeo: function(){

        this.ACTIVE_PARTICLE = 0;
        this.rateCounter = 0;
        this.TIME = 0;


        let particleGeo;
        let attrBuilder;

        if( this.params.DISPLAY_MODE === "object" ){

            particleGeo = new THREE.InstancedBufferGeometry();
            attrBuilder = ( arrSize, itemSize ) => new THREE.InstancedBufferAttribute( new Float32Array( arrSize * itemSize ), itemSize ).setDynamic( true );

            this.instanceObject = new THREE.BufferGeometry().fromGeometry( new THREE.BoxGeometry() );

            particleGeo.addAttribute( 'position',   this.instanceObject.attributes.position.clone() );
            particleGeo.addAttribute( 'uv',         this.instanceObject.attributes.uv.clone() );

        } else{

            particleGeo = new THREE.BufferGeometry();
            attrBuilder = ( arrSize, itemSize ) => new THREE.BufferAttribute( new Float32Array( arrSize * itemSize ), itemSize ).setDynamic( true );

            particleGeo.addAttribute( 'position',   attrBuilder( this._softParticleLimit, 3 ) );

        }

        particleGeo.addAttribute( 'offset',     attrBuilder( this._softParticleLimit, 3 ) );
        particleGeo.addAttribute( 'birthTime',  attrBuilder( this._softParticleLimit, 1 ) );
        particleGeo.addAttribute( 'velocity',   attrBuilder( this._softParticleLimit, 3 ) );
        particleGeo.addAttribute( 'colour',     attrBuilder( this._softParticleLimit, 4 ) );
        particleGeo.addAttribute( 'size',       attrBuilder( this._softParticleLimit, 1 ) );
        particleGeo.addAttribute( 'lifetime',   attrBuilder( this._softParticleLimit, 1 ) );

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
                                    blending: THREE.NormalBlending,
                                    transparent: true,

                                });

    },

    exportState: function(){

        console.log ( JSON.stringify( this.params ) );

    },

    spawnParticle: function(){

        const i = this.ACTIVE_PARTICLE;

        this._offset = this._offset || i;
        this._count++;

        const offsetAttribute =   this.points.geometry.getAttribute( 'offset' );
        const birthTimeAttribute =  this.points.geometry.getAttribute( 'birthTime' );
        const velocityAttribute =   this.points.geometry.getAttribute( 'velocity' );
        const colourAttribute =     this.points.geometry.getAttribute( 'colour' );
        const sizeAttribute =       this.points.geometry.getAttribute( 'size' );
        const lifetimeAttribute =   this.points.geometry.getAttribute( 'lifetime' );

        const colour = this.params.INIT_COL.clone();

        let [ position, normal ] = this.calcOffset( this.params.INIT_POS.clone() );

        offsetAttribute.array[ i * 3     ] = position.x + this.params.VAR_POS.x * THREE.Math.randFloat( -1, 1 );
        offsetAttribute.array[ i * 3 + 1 ] = position.y + this.params.VAR_POS.y * THREE.Math.randFloat( -1, 1 );
        offsetAttribute.array[ i * 3 + 2 ] = position.z + this.params.VAR_POS.z * THREE.Math.randFloat( -1, 1 );


        //Velocity
        velocityAttribute.array[ i * 3     ] = this.params.INIT_VEL.x + this.params.NORM_VEL * ( 1- this.params.VAR_NORM_VEL * THREE.Math.randFloat( -1, 1 ) ) * normal.x + this.params.VAR_VEL.x * THREE.Math.randFloat( -1, 1 );
        velocityAttribute.array[ i * 3 + 1 ] = this.params.INIT_VEL.y + this.params.NORM_VEL * ( 1- this.params.VAR_NORM_VEL * THREE.Math.randFloat( -1, 1 ) ) * normal.y + this.params.VAR_VEL.y * THREE.Math.randFloat( -1, 1 );
        velocityAttribute.array[ i * 3 + 2 ] = this.params.INIT_VEL.z + this.params.NORM_VEL * ( 1- this.params.VAR_NORM_VEL * THREE.Math.randFloat( -1, 1 ) ) * normal.z + this.params.VAR_VEL.z * THREE.Math.randFloat( -1, 1 );


        //Colour
        colour.x = THREE.Math.clamp( colour.x + this.params.VAR_COL.x * THREE.Math.randFloat( -1, 1 ), 0, 1 );
        colour.y = THREE.Math.clamp( colour.y + this.params.VAR_COL.y * THREE.Math.randFloat( -1, 1 ), 0, 1 );
        colour.z = THREE.Math.clamp( colour.z + this.params.VAR_COL.z * THREE.Math.randFloat( -1, 1 ), 0, 1 );
        colour.w = THREE.Math.clamp( colour.w + this.params.VAR_COL.w * THREE.Math.randFloat( -1, 1 ), 0, 1 );

        colourAttribute.array[ i * 4     ] = colour.x;
        colourAttribute.array[ i * 4 + 1 ] = colour.y;
        colourAttribute.array[ i * 4 + 2 ] = colour.z;
        colourAttribute.array[ i * 4 + 3 ] = colour.w;

        // size, lifetime and starttime
        sizeAttribute.array[ i ] = this.params.SIZE + THREE.Math.randFloat( -1, 1 ) * this.params.VAR_SIZE;
        lifetimeAttribute.array[ i ] = this.params.LIFETIME + THREE.Math.randFloat( -1, 1 ) * this.params.VAR_LIFETIME;
        birthTimeAttribute.array[ i ] = this.TIME;

        this.ACTIVE_PARTICLE >= this._softParticleLimit && console.log( "boop" );
        this.ACTIVE_PARTICLE = this.ACTIVE_PARTICLE >= this._softParticleLimit ? 0 : this.ACTIVE_PARTICLE + 1;

    },

    updateGeo: function(){

        ['offset', 'birthTime', 'velocity', 'colour', 'size', 'lifetime'].forEach( attrName => {

            const attr = this.points.geometry.getAttribute( attrName );

            attr.updateRange.count = this._count * attr.itemSize;
            attr.updateRange.offset = this._offset * attr.itemSize;

            attr.needsUpdate = true;

        })

    },

    update: function(){

        const delta = clock.getDelta() * this.params.TIME_SCALE;

        this.TIME += delta;
        this.count = 0;

        if( this.TIME < 0 ) this.TIME = 0;

        if ( delta > 0 && this.TIME > this.rateCounter/this.params.SPAWN_RATE ) {

            for( let i = 0; i < this.params.SPAWN_RATE*delta; i++){

                this.rateCounter++;
                this.spawnParticle();

            }

        }

        this.updateGeo();
        this.points.material.uniforms.uTime.value = this.TIME;

    },

    dispose: function () {

		this.points.geometry.dispose();
		this.points.material.dispose();

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
        emitter.add( this, "animateSpawn" ).onChange( () => this.init( true ) );

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
        velocity.add( this, "varyNormalVelocity", 0, 1, 0.1 );
        addVectorProp( velocity, "Initial", this.initVelocity, -5, 5 );
        addVectorProp( velocity, "Variance", this.varyVelocity, 0, 5 );
        let color = particle.addFolder( "Color" );
        addVectorProp( color, "Initial", this.initColour, 0, 1 );
        addVectorProp( color, "Variance", this.varyColour, 0, 1 );

        //////Display Settings//////
        let display = gui.addFolder( "Display" );
        display.add( this, "displayMode", {Point: "shader", Object: "object"}).onChange( () => this.init( true ) );

        gui.add( this, "exportState" );



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

        get: function(){ return this.params.MAX_PARTICLES },

        set: function( value ){

            console.warn( "New particle limit. Rebuilding system." );
            this.params.MAX_PARTICLES = value;
            this.init( true );

        }

    },
    "_softParticleLimit": {

        get: function(){

            let tmp = this.PARTICLE_LIMIT_REACHED ? this.params.MAX_PARTICLES : this.params.SPAWN_RATE * ( this.params.LIFETIME + this.params.VAR_LIFETIME );

            if( tmp > this.params.MAX_PARTICLES ){

                tmp = this.params.MAX_PARTICLES;
                console.warn( "Max number of Particles will be exceeded with current Spawn Rate and Lifetime! Capping to .maxParticles; increase to remove limit." );
                this.PARTICLE_LIMIT_REACHED = true;

            }

            if( this.params.ANIMATE_SPAWN ) tmp = this.params.MAX_PARTICLES;

            return tmp

        },

       set: function( value ){ console.warn( "This value is used internally, there is nothing to set. Perhaps you meant to set .maxParticles?" ) }

    },
    "spawnRate": {

        get: function(){ return this.params.SPAWN_RATE },

        set: function( value ){

            this.params.SPAWN_RATE = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ); };

        }

    },
    "animateSpawn": {

        get: function(){ return this.params.ANIMATE_SPAWN },

        set: function( value ){

            this.params.ANIMATE_SPAWN = value
            console.warn( "Modifying .animateSpawn dynamically requires a rebuild. Call .init( true ) to reinitialise Particle System." )

        }

    },

    "emitFrom": {

        get: function(){ return this.params.SPAWN_EMITFROM },

        set: function( value ){ this.params.SPAWN_EMITFROM = value; }

    },
    "elementDistribution": {

        get: function(){ return this.params.SPAWN_ELDISTRIB },

        set: function( value ){

            this.params.SPAWN_ELDISTRIB = value;

            if( this.params.SPAWN_ELDISTRIB > ( this.params.SPAWN_EMITFROM === "vert" ? this.source.geometry.vertices.length : this.source.geometry.faces.length ) - 1 ) this.emitIndex = 0;

        }

    },
    "emitIndex": {

        get: function(){ return this.params.SPAWN_INDEX },

        set: function( value ){ this.params.SPAWN_INDEX = value }

    },
    "emitDistribution": {

        get: function(){ return this.params.SPAWN_EMDISTRIB },

        set: function( value ){ this.params.SPAWN_EMDISTRIB = value }

    },
    "gridResolution": {

        get: function(){ console.log( "Not yet implemented" ) },//return this.params.GRID_RESOLUTION },

        set: function( value ){ this.params.GRID_RESOLUTION = value }

    },

    "size": {

        get: function(){ return this.params.SIZE },

        set: function( value ){

            this.params.SIZE = value;

        }

    },
    "varySize": {

        get: function(){ return this.params.VAR_SIZE },

        set: function( value ){

            this.params.VAR_SIZE = value;

        }

    },

    "lifetime": {

        get: function(){ return this.params.LIFETIME },

        set: function( value ){

            this.params.LIFETIME = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ) };

        }

    },
    "varyLifetime": {

        get: function(){ return this.params.VAR_LIFETIME },

        set: function( value ){

            this.params.VAR_LIFETIME = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ) };

        }

    },

    "initPosition": {

        get: function(){ return this.params.INIT_POS },

        set: function( value ){

            this.params.INIT_POS = this.opt_FloatToVec( value );

        }

    },
    "varyPosition": {

        get: function(){ return this.params.VAR_POS },

        set: function( value ){

            this.params.VAR_POS = this.opt_FloatToVec( value );

        }

    },

    "normalVelocity": {

       get: function(){ return this.params.NORM_VEL },

       set: function( value ){ this.params.NORM_VEL = value }

    },
    "varyNormalVelocity": {

       get: function(){ return this.params.VAR_NORM_VEL },

       set: function( value ){ this.params.VAR_NORM_VEL = value }

    },
    "initVelocity": {

        get: function(){ return this.params.INIT_VEL },

        set: function( value ){

            this.params.INIT_VEL = this.opt_FloatToVec( value );

        }

    },
    "varyVelocity": {

        get: function(){ return this.params.VAR_VEL },

        set: function( value ){

            this.params.VAR_VEL = this.opt_FloatToVec( value );

        }

    },

    "initColour": {

        get: function(){ return this.params.INIT_COL },

        set: function( value ){

            this.params.INIT_COL = this.opt_FloatToVec( value );

        }

    },
    "varyColour": {

        get: function(){ return this.params.VAR_COL },

        set: function( value ){

            this.params.VAR_COL = this.opt_FloatToVec( value );

        }

    },

    "displayMode": {

        get: function(){ return this.params.DISPLAY_MODE },

        set: function( value ){

            this.params.DISPLAY_MODE = value;
            console.warn( "Modifying .displayMode dynamically requires a rebuild. Call .init( true ) to reinitialise Particle System.")
            this.init();

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
